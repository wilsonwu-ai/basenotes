"""HuggingFace transformers backend for local checkpoints.

Device auto-pick: cuda > mps > cpu, so the same command works on a
rented GPU box and on an Apple Silicon Mac. Point ``--model`` at a hub
id or a local checkpoint directory (config + weights + tokenizer).

Context handling matters for small models: a GPT-2-tokenizer model with
1024 positions can overflow on MBPP few-shot prompts, so max_new_tokens
is clamped to the space left and over-long prompts yield empty
completions (counted as failures) with a warning rather than a crash.
"""

from __future__ import annotations

import warnings


class HFBackend:
    name = "hf"

    def __init__(
        self,
        model: str,
        *,
        device: str | None = None,
        dtype: str | None = None,
        trust_remote_code: bool = False,
        seed: int | None = None,
        batch_size: int = 8,
    ):
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.torch = torch
        if device is None:
            if torch.cuda.is_available():
                device = "cuda"
            elif getattr(torch.backends, "mps", None) and torch.backends.mps.is_available():
                device = "mps"
            else:
                device = "cpu"
        self.device = device

        if dtype is not None:
            torch_dtype = getattr(torch, dtype)
        elif device == "cuda":
            torch_dtype = (
                torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16
            )
        elif device == "mps":
            torch_dtype = torch.float16
        else:
            torch_dtype = torch.float32

        self.tokenizer = AutoTokenizer.from_pretrained(
            model, trust_remote_code=trust_remote_code
        )
        if self.tokenizer.pad_token is None:
            self.tokenizer.pad_token = self.tokenizer.eos_token
        self.model = (
            AutoModelForCausalLM.from_pretrained(
                model, torch_dtype=torch_dtype, trust_remote_code=trust_remote_code
            )
            .to(device)
            .eval()
        )
        config = self.model.config
        self.context_len = getattr(config, "max_position_embeddings", None) or getattr(
            config, "n_positions", None
        )
        self.batch_size = batch_size
        if seed is not None:
            torch.manual_seed(seed)
        self._warned_greedy = False

    def generate(
        self,
        prompt: str,
        n: int,
        *,
        max_new_tokens: int = 512,
        temperature: float = 0.0,
        top_p: float = 0.95,
        stop=None,
        problem=None,
    ) -> list[str]:
        torch = self.torch
        enc = self.tokenizer(prompt, return_tensors="pt").to(self.device)
        input_len = enc["input_ids"].shape[1]

        if self.context_len is not None:
            available = self.context_len - input_len
            if available <= 0:
                warnings.warn(
                    f"prompt ({input_len} tokens) exceeds model context "
                    f"({self.context_len}); returning empty completions. "
                    "Try fewer MBPP shots (--mbpp-shots)."
                )
                return [""] * n
            max_new_tokens = min(max_new_tokens, available)

        greedy = temperature is None or temperature <= 0.0
        if greedy and n > 1 and not self._warned_greedy:
            self._warned_greedy = True
            warnings.warn(
                "temperature=0 with n>1: greedy decoding returns identical "
                "samples, so pass@k>1 is meaningless. Use --temperature 0.8 "
                "for pass@10-style runs."
            )

        completions: list[str] = []
        with torch.no_grad():
            if greedy:
                output = self.model.generate(
                    **enc,
                    max_new_tokens=max_new_tokens,
                    do_sample=False,
                    pad_token_id=self.tokenizer.pad_token_id,
                )
                text = self.tokenizer.decode(
                    output[0][input_len:], skip_special_tokens=True
                )
                completions = [text] * n
            else:
                while len(completions) < n:
                    batch = min(self.batch_size, n - len(completions))
                    output = self.model.generate(
                        **enc,
                        max_new_tokens=max_new_tokens,
                        do_sample=True,
                        temperature=temperature,
                        top_p=top_p,
                        num_return_sequences=batch,
                        pad_token_id=self.tokenizer.pad_token_id,
                    )
                    for row in output:
                        completions.append(
                            self.tokenizer.decode(
                                row[input_len:], skip_special_tokens=True
                            )
                        )
        return completions[:n]

    def perplexity(self, text: str, stride: int | None = None) -> float:
        """Sliding-window perplexity of a text under the model."""
        torch = self.torch
        ids = self.tokenizer(text, return_tensors="pt")["input_ids"].to(self.device)
        n_tokens = ids.shape[1]
        if n_tokens < 2:
            raise ValueError("text too short to compute perplexity")
        window = self.context_len or 1024
        stride = stride or window // 2
        total_nll = 0.0
        total_counted = 0
        prev_end = 0
        with torch.no_grad():
            for begin in range(0, n_tokens, stride):
                end = min(begin + window, n_tokens)
                target_start = max(prev_end - begin, 1)
                chunk = ids[:, begin:end]
                targets = chunk.clone()
                targets[:, :target_start] = -100
                out = self.model(chunk, labels=targets)
                counted = int((targets != -100).sum())
                total_nll += float(out.loss) * counted
                total_counted += counted
                prev_end = end
                if end == n_tokens:
                    break
        import math

        return math.exp(total_nll / total_counted)

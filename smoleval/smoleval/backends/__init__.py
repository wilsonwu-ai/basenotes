"""Generation backends.

Every backend exposes:

    generate(prompt, n, *, max_new_tokens, temperature, top_p,
             stop=None, problem=None) -> list[str]

returning n completion strings (text *after* the prompt). ``problem`` is
the smoleval problem dict; real backends ignore it, the dry-run backend
uses it to fetch reference solutions.
"""

from __future__ import annotations


def make_backend(name: str, model: str, **kwargs):
    if name == "hf":
        from .hf import HFBackend

        return HFBackend(model, **kwargs)
    if name == "openai":
        from .openai_api import OpenAIBackend

        return OpenAIBackend(model, **kwargs)
    if name == "dryrun":
        from .dryrun import DryRunBackend

        return DryRunBackend(model)
    raise ValueError(f"unknown backend {name!r}, choose from hf, openai, dryrun")

/**
 * Deliberately unprivileged embedded-app bootstrap shell. It contains no
 * schedule, catalog, staff, customer, or provider data. App Bridge obtains a
 * fresh Shopify ID token before the protected same-origin API renders UI.
 */
export function renderStagingAdminSchedulerShell(input: {
  readonly apiPath: string;
  readonly clientId: string;
}): string {
  const clientId = escapeHtml(input.clientId);
  const apiPath = JSON.stringify(input.apiPath);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="shopify-api-key" content="${clientId}">
    <title>Base Note staging FOTM scheduler</title>
    <script src="https://cdn.shopify.com/shopifycloud/app-bridge.js"></script>
    <style>
      :root { color-scheme: light; --ink:#171513; --paper:#f5f0e7; --panel:#fffcf7; --line:#d4c8b7; --muted:#655d55; --gold:#9d7140; --danger:#8b2924; }
      * { box-sizing:border-box; }
      body { background:var(--paper); color:var(--ink); font:16px/1.5 Georgia,serif; margin:0; }
      main { margin:0 auto; max-width:56rem; padding:2rem 1rem 3rem; }
      h1,h2 { font-weight:400; line-height:1.15; } h1 { margin:0 0 .35rem; } h2 { font-size:1.2rem; margin-top:0; }
      .panel { background:var(--panel); border:1px solid var(--line); margin-top:1rem; padding:1rem; }
      .notice { border-left:.3rem solid var(--gold); color:#493418; padding:.75rem 1rem; background:#f3eadc; }
      .error { border-left-color:var(--danger); color:#651f1c; }
      form,.fields { display:grid; gap:.7rem; } label { font-weight:700; } input,select,button { font:inherit; min-height:2.6rem; padding:.45rem .6rem; } input,select { background:#fff; border:1px solid var(--ink); width:100%; } button { background:var(--ink); border:1px solid var(--ink); color:#fff; cursor:pointer; } button.secondary { background:transparent; color:var(--ink); } button:focus-visible,input:focus-visible,select:focus-visible { outline:3px solid #1f5d9d; outline-offset:2px; }
      .schedule { border-top:1px solid var(--line); display:grid; gap:.6rem; padding:1rem 0; } .schedule:first-child { border-top:0; padding-top:0; } .meta { color:var(--muted); font-size:.92rem; } .actions { display:flex; flex-wrap:wrap; gap:.5rem; } code { overflow-wrap:anywhere; } .hidden { display:none; }
    </style>
  </head>
  <body>
    <main>
      <p class="meta">Base Note · staging only</p>
      <h1>Future FOTM scheduler</h1>
      <p class="notice">A published FOTM is the visibly pre-selected, one included fragrance after it is provisioned to an exact future shipment. It is not an add-on. A member may still save a separate override before the Central-time cutoff. Retiring or recovering a schedule never silently changes an already published or locked shipment.</p>
      <p id="status" class="notice" role="status">Authenticating scheduler…</p>
      <section id="scheduler" class="hidden" aria-label="FOTM scheduler"></section>
    </main>
    <script>
      (() => {
        const API_PATH = ${apiPath};
        const PENDING_STORAGE_KEY = "basenote.staging.admin-scheduler.pending.v1";
        const state = { pending: restorePending(), pendingProvisionCommands: [], provisionCommands: [], retryInFlight: false, schedules: [], variants: [] };
        const status = document.getElementById("status");
        const scheduler = document.getElementById("scheduler");

        function message(text, error) {
          status.textContent = text;
          status.classList.toggle("error", Boolean(error));
        }
        function element(name, text) {
          const node = document.createElement(name);
          if (text !== undefined) node.textContent = text;
          return node;
        }
        function idempotencyKey() {
          return "pfk_" + crypto.randomUUID().replaceAll("-", "");
        }
        function isRecord(value) {
          return Boolean(value) && typeof value === "object" && !Array.isArray(value);
        }
        function hasExactKeys(value, expected) {
          if (!isRecord(value)) return false;
          const actual = Object.keys(value).sort();
          const required = [...expected].sort();
          return actual.length === required.length && actual.every((key, index) => key === required[index]);
        }
        function isRevision(value, nullable) {
          return (nullable && value === null) || (Number.isSafeInteger(value) && value >= 0);
        }
        function isRestorableCommand(command) {
          if (!isRecord(command) || typeof command.action !== "string" || !/^\\d{4}-(0[1-9]|1[0-2])$/.test(command.shipMonth)) return false;
          if (command.action === "SAVE_DRAFT" || command.action === "RECOVER_DRAFT") {
            return hasExactKeys(command, ["action", "cutoffAt", "expectedRevision", "merchantTimezone", "shipMonth", "variantId"])
              && typeof command.cutoffAt === "string" && command.cutoffAt.length <= 64
              && isRevision(command.expectedRevision, command.action === "SAVE_DRAFT")
              && command.merchantTimezone === "America/Chicago"
              && typeof command.variantId === "string" && /^gid:\\/\\/shopify\\/ProductVariant\\/\\d+$/.test(command.variantId);
          }
          if (command.action === "PUBLISH" || command.action === "RETIRE" || command.action === "RECORD_RECOVERY_EXCEPTION") {
            return hasExactKeys(command, ["action", "expectedRevision", "shipMonth"]) && isRevision(command.expectedRevision, false);
          }
          if (command.action === "PROVISION" || command.action === "MARK_PROVISION_NEEDS_ATTENTION") {
            return hasExactKeys(command, ["action", "expectedScheduleRevision", "shipMonth"]) && isRevision(command.expectedScheduleRevision, false);
          }
          return false;
        }
        function discardStoredPending() {
          try { sessionStorage.removeItem(PENDING_STORAGE_KEY); } catch {}
        }
        function restorePending() {
          try {
            const stored = JSON.parse(sessionStorage.getItem(PENDING_STORAGE_KEY) || "null");
            if (!isRecord(stored) || stored.version !== 1 || typeof stored.key !== "string" || !/^pfk_[A-Za-z0-9][A-Za-z0-9._:-]{7,191}$/.test(stored.key) || typeof stored.payload !== "string" || stored.payload.length > 8192) {
              discardStoredPending();
              return null;
            }
            const command = JSON.parse(stored.payload);
            if (!isRestorableCommand(command) || JSON.stringify(command) !== stored.payload) {
              discardStoredPending();
              return null;
            }
            return { command, key:stored.key, payload:stored.payload };
          } catch {
            discardStoredPending();
            return null;
          }
        }
        function retainPending(pending) {
          state.pending = pending;
          try { sessionStorage.setItem(PENDING_STORAGE_KEY, JSON.stringify({ key:pending.key, payload:pending.payload, version:1 })); } catch {}
        }
        function clearPending(pending) {
          if (state.pending !== pending) return;
          state.pending = null;
          discardStoredPending();
        }
        async function idToken() {
          if (!window.shopify || typeof window.shopify.idToken !== "function") throw new Error("Shopify App Bridge did not provide an ID token.");
          return window.shopify.idToken();
        }
        class SchedulerOutcomeUnknownError extends Error {}
        function unknownOutcome(hasCommand) {
          return new SchedulerOutcomeUnknownError(hasCommand
            ? "The request outcome is unknown. Use Retry pending request to resend the exact payload with the same protected command key."
            : "The scheduler response could not be confirmed. Reload the page and try again.");
        }
        async function api(method, commandPayload, commandKey) {
          const token = await idToken();
          const headers = { Authorization: "Bearer " + token };
          if (commandPayload !== undefined) {
            headers["Content-Type"] = "application/json";
            headers["Idempotency-Key"] = commandKey;
          }
          let response;
          try {
            response = await fetch(API_PATH, { method, headers, body: commandPayload, credentials: "same-origin" });
          } catch {
            throw unknownOutcome(commandPayload !== undefined);
          }
          const isClientError = response.status >= 400 && response.status < 500;
          let body;
          try { body = await response.json(); } catch {
            if (!isClientError) throw unknownOutcome(commandPayload !== undefined);
            body = {};
          }
          if (!response.ok) {
            if (!isClientError) throw unknownOutcome(commandPayload !== undefined);
            const errorCode = body && typeof body === "object" ? body.error : undefined;
            throw new Error(errorCode === "unauthorized" ? "Shopify Admin authentication was rejected. Refresh the page and try again." : errorCode === "forbidden" ? "This Shopify staff account is not allowlisted for staging." : errorCode === "schedule_conflict" ? "The schedule changed. Reloaded the latest state." : errorCode === "schedule_needs_attention" ? "This month already has a provisioned FOTM cycle. It was not retired or replaced; record the no-mutation recovery exception for review." : errorCode === "provision_recovery_required" ? "The prior bounded provision command has no durable result. It was not run again; inspect its staging audit before creating a new command." : errorCode === "provision_recovery_not_ready" ? "The pending provision command is still within its 15-minute recovery delay and was not changed." : "The staging scheduler could not complete that request.");
          }
          return body;
        }
        function isMutationSuccess(command, result) {
          if (!isRecord(result) || typeof result.replayed !== "boolean") return false;
          if (command.action === "SAVE_DRAFT" || command.action === "RECOVER_DRAFT" || command.action === "PUBLISH" || command.action === "RETIRE") {
            const expectedStatus = command.action === "PUBLISH" ? "PUBLISHED" : command.action === "RETIRE" ? "RETIRED" : "DRAFT";
            return isRecord(result.schedule)
              && result.schedule.shipMonth === command.shipMonth
              && result.schedule.status === expectedStatus
              && isRevision(result.schedule.revision, false);
          }
          if (command.action === "RECORD_RECOVERY_EXCEPTION") return result.attention === "RECOVERY_EXCEPTION_RECORDED";
          if (command.action === "MARK_PROVISION_NEEDS_ATTENTION") return result.attention === "PROVISION_NEEDS_ATTENTION_RECORDED";
          if (command.action === "PROVISION") {
            const provisioning = result.provisioning;
            return isRecord(provisioning)
              && Number.isSafeInteger(provisioning.configured) && provisioning.configured >= 0
              && Number.isSafeInteger(provisioning.conflicted) && provisioning.conflicted >= 0
              && Number.isSafeInteger(provisioning.scanned) && provisioning.scanned >= 0
              && provisioning.configured + provisioning.conflicted === provisioning.scanned
              && typeof provisioning.mayHaveMore === "boolean"
              && typeof provisioning.replayed === "boolean";
          }
          return false;
        }
        async function post(command, options = {}) {
          const payload = JSON.stringify(command);
          const retry = options.retry === true;
          let pending;
          if (retry) {
            if (state.retryInFlight) throw new Error("The protected retry is already in progress.");
            if (!state.pending || state.pending.payload !== payload) throw new Error("The pending request changed and was not retried. Reload the scheduler before continuing.");
            pending = state.pending;
            state.retryInFlight = true;
          } else {
            if (state.pending) throw new Error("A prior request has an unknown outcome. Use Retry pending request before sending another command.");
            pending = { command: JSON.parse(payload), payload, key: options.fixedKey || idempotencyKey() };
            retainPending(pending);
          }
          try {
            const result = await api("POST", pending.payload, pending.key);
            if (!isMutationSuccess(pending.command, result)) throw unknownOutcome(true);
            clearPending(pending);
            return result;
          } catch (error) {
            if (error instanceof SchedulerOutcomeUnknownError) {
              if (retry) state.retryInFlight = false;
              retainPending(pending);
              render();
            } else {
              clearPending(pending);
            }
            throw error;
          } finally {
            if (retry) state.retryInFlight = false;
          }
        }
        function pendingPanel() {
          const panel = element("section"); panel.className = "panel";
          panel.append(element("h2", "Confirm an uncertain request"));
          panel.append(element("p", "The previous request did not return a confirmed result. Only this button resends its exact payload with the original idempotency key and a fresh Shopify ID token."));
          const retry = element("button", "Retry pending request"); retry.type = "button"; retry.disabled = state.retryInFlight;
          retry.addEventListener("click", async () => {
            if (state.retryInFlight) return;
            const pendingCommand = state.pending;
            if (!pendingCommand) return;
            retry.disabled = true;
            try { message("Retrying protected staging request…"); await post(pendingCommand.command, { retry:true }); await load(); message("Pending request confirmed."); } catch (error) { message(error instanceof Error ? error.message : "Pending request was not confirmed.", true); await load().catch(() => {}); } finally { retry.disabled = false; }
          });
          panel.append(retry);
          return panel;
        }
        function renderPendingOnly() {
          if (!state.pending) return;
          scheduler.replaceChildren(pendingPanel());
          scheduler.classList.remove("hidden");
        }
        function currentSchedule(shipMonth) { return state.schedules.find((schedule) => schedule.shipMonth === shipMonth) || null; }
        function render() {
          scheduler.replaceChildren();
          const create = element("section"); create.className = "panel";
          create.append(element("h2", "Schedule an included FOTM default"));
          const help = element("p", "Enter the exact UTC cutoff; the server accepts only 12:01 AM America/Chicago, including DST. The legacy theme FOTM is display-only and does not enforce this schedule."); help.className = "meta"; create.append(help);
          const form = element("form");
          const monthLabel = element("label", "Ship month"); const month = element("input"); month.type = "month"; month.name = "shipMonth"; month.required = true; monthLabel.append(month);
          const cutoffLabel = element("label", "Cutoff UTC timestamp"); const cutoff = element("input"); cutoff.type = "text"; cutoff.name = "cutoffAt"; cutoff.placeholder = "2026-10-10T05:01:00.000Z"; cutoff.required = true; cutoffLabel.append(cutoff);
          const variantLabel = element("label", "Allowed disposable test fragrance"); const variant = element("select"); variant.name = "variantId"; variant.required = true; for (const item of state.variants) { const option = element("option", item.label); option.value = item.variantId; variant.append(option); } variantLabel.append(variant);
          const save = element("button", "Save draft / explicitly recover retired month"); save.type = "submit";
          form.append(monthLabel, cutoffLabel, variantLabel, save);
          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const existing = currentSchedule(month.value);
            try {
              if (existing && existing.status === "PUBLISHED") throw new Error("Retire this published schedule before creating an explicit recovery draft. Existing published and locked cycles will remain unchanged.");
              const action = existing && existing.status === "RETIRED" ? "RECOVER_DRAFT" : "SAVE_DRAFT";
              message(action === "RECOVER_DRAFT" ? "Recording explicit staging recovery draft…" : "Saving staging draft…");
              await post({ action, shipMonth:month.value, cutoffAt:cutoff.value, merchantTimezone:"America/Chicago", variantId:variant.value, expectedRevision:existing ? existing.revision : null });
              await load();
              message(action === "RECOVER_DRAFT" ? "Recovery draft saved. Publish and provision it explicitly when reviewed." : "Draft saved.");
            } catch (error) { message(error instanceof Error ? error.message : "Draft was not saved.", true); await load().catch(() => {}); }
          });
          create.append(form); scheduler.append(create);
          if (state.pending) scheduler.append(pendingPanel());

          const list = element("section"); list.className = "panel"; list.append(element("h2", "Future-month schedules"));
          if (state.schedules.length === 0) list.append(element("p", "No authorized staging schedules are configured."));
          for (const schedule of state.schedules) {
            const row = element("article"); row.className = "schedule";
            row.append(element("strong", schedule.shipMonth + " · " + schedule.status));
            const details = element("p", "Included FOTM default: " + schedule.variantId + " · cutoff " + schedule.cutoffAt + " · revision " + schedule.revision); details.className = "meta"; row.append(details);
            const actions = element("div"); actions.className = "actions";
            const pendingCommands = state.pendingProvisionCommands.filter((command) => command.shipMonth === schedule.shipMonth && command.status === "PENDING");
            if (schedule.status === "DRAFT") {
              const publish = element("button", "Publish this month"); publish.type = "button";
              publish.addEventListener("click", async () => {
                try { message("Publishing staging schedule…"); await post({ action:"PUBLISH", shipMonth:schedule.shipMonth, expectedRevision:schedule.revision }); await load(); message("Schedule published. Provision exact future cycles when ready."); } catch (error) { message(error instanceof Error ? error.message : "Schedule was not published.", true); await load().catch(() => {}); }
              }); actions.append(publish);
            }
            if (schedule.status === "DRAFT" || schedule.status === "PUBLISHED") {
              const retire = element("button", "Retire this month"); retire.type = "button"; retire.className = "secondary";
              retire.addEventListener("click", async () => {
                if (!window.confirm("Retire this staging schedule? This does not change any already published or locked shipment.")) return;
                try { message("Retiring staging schedule without changing cycles…"); await post({ action:"RETIRE", shipMonth:schedule.shipMonth, expectedRevision:schedule.revision }); await load(); message("Schedule retired. Use the explicit recovery draft flow to replace it."); } catch (error) { message(error instanceof Error ? error.message : "Schedule was not retired.", true); await load().catch(() => {}); }
              }); actions.append(retire);
            }
            if (schedule.status === "PUBLISHED") {
              const provision = element("button", "Provision up to five cycles"); provision.type = "button"; provision.className = "secondary";
              provision.addEventListener("click", async () => {
                try { message("Provisioning bounded staging cycles…"); const result = await post({ action:"PROVISION", shipMonth:schedule.shipMonth, expectedScheduleRevision:schedule.revision }); await load(); message("Provisioned " + result.provisioning.configured + " cycle(s); conflicts " + result.provisioning.conflicted + (result.provisioning.mayHaveMore ? ". Run again for the next bounded batch." : ".")); } catch (error) { message(error instanceof Error ? error.message : "Cycles were not provisioned.", true); await load().catch(() => {}); }
              }); actions.append(provision);
              for (const command of pendingCommands) {
                const attention = element("button", "Mark pending provision needs attention"); attention.type = "button"; attention.className = "secondary";
                attention.addEventListener("click", async () => {
                  if (!window.confirm("Mark this aged unknown-outcome staging provision for manual review? It will not retry, alter a schedule, or change a shipment.")) return;
                  try { message("Terminalizing the aged provision claim without fan-out…"); await post({ action:"MARK_PROVISION_NEEDS_ATTENTION", shipMonth:schedule.shipMonth, expectedScheduleRevision:command.expectedScheduleRevision }, { fixedKey:command.idempotencyKey }); await load(); message("Provision command marked needs attention. No schedule or cycle changed."); } catch (error) { message(error instanceof Error ? error.message : "Provision command was not changed.", true); await load().catch(() => {}); }
                }); actions.append(attention);
              }
              const exception = element("button", "Record no-mutation recovery exception"); exception.type = "button"; exception.className = "secondary";
              exception.addEventListener("click", async () => {
                if (!window.confirm("Record an immutable staging recovery exception only if this month already has a provisioned FOTM cycle? This will not change any schedule or shipment.")) return;
                try { message("Recording no-mutation recovery attention…"); await post({ action:"RECORD_RECOVERY_EXCEPTION", shipMonth:schedule.shipMonth, expectedRevision:schedule.revision }); message("Recovery exception recorded for manual review. No schedule or cycle changed."); } catch (error) { message(error instanceof Error ? error.message : "Recovery exception was not recorded.", true); await load().catch(() => {}); }
              }); actions.append(exception);
            }
            if (schedule.status === "RETIRED") {
              row.append(element("p", "Retired: no new cycles can be provisioned. Already published or locked cycles keep their prior FOTM; enter this month above and submit the explicit recovery draft to create a reviewed replacement."));
              const recover = element("button", "Load for explicit recovery"); recover.type = "button"; recover.className = "secondary";
              recover.addEventListener("click", () => {
                month.value = schedule.shipMonth;
                cutoff.value = schedule.cutoffAt;
                variant.value = schedule.variantId;
                month.focus();
                message("Replacement values loaded. Submit the explicit recovery draft when ready.");
              }); actions.append(recover);
            }
            row.append(actions); list.append(row);
          }
          scheduler.append(list);
        }
        async function load() {
          const result = await api("GET");
          state.pendingProvisionCommands = Array.isArray(result.pendingProvisionCommands) ? result.pendingProvisionCommands : [];
          state.provisionCommands = Array.isArray(result.provisionCommands) ? result.provisionCommands : [];
          state.schedules = Array.isArray(result.schedules) ? result.schedules : [];
          state.variants = Array.isArray(result.variants) ? result.variants : [];
          render(); scheduler.classList.remove("hidden");
        }
        if (state.pending) {
          renderPendingOnly();
          message("An earlier request still has an unknown outcome. Confirm it before sending another command.", true);
        }
        load().then(() => message(state.pending ? "Authenticated. An uncertain request is preserved for deliberate retry." : "Authenticated staging scheduler ready.", Boolean(state.pending))).catch((error) => {
          if (state.pending) renderPendingOnly();
          message(error instanceof Error ? error.message : "Scheduler authentication failed.", true);
        });
      })();
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
  })[character] ?? character);
}

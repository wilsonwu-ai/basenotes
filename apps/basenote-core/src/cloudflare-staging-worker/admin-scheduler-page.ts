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
      <p class="notice">A published FOTM is the visibly pre-selected, one included fragrance after it is provisioned to an exact future shipment. It is not an add-on. A member may still save a separate override before the Central-time cutoff.</p>
      <p id="status" class="notice" role="status">Authenticating scheduler…</p>
      <section id="scheduler" class="hidden" aria-label="FOTM scheduler"></section>
    </main>
    <script>
      (() => {
        const API_PATH = ${apiPath};
        const state = { pending: null, schedules: [], variants: [] };
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
        async function idToken() {
          if (!window.shopify || typeof window.shopify.idToken !== "function") throw new Error("Shopify App Bridge did not provide an ID token.");
          return window.shopify.idToken();
        }
        class SchedulerTransportError extends Error {}
        async function api(method, command, commandKey) {
          const token = await idToken();
          const headers = { Authorization: "Bearer " + token };
          if (command) {
            headers["Content-Type"] = "application/json";
            headers["Idempotency-Key"] = commandKey;
          }
          let response;
          try {
            response = await fetch(API_PATH, { method, headers, body: command ? JSON.stringify(command) : undefined, credentials: "same-origin" });
          } catch {
            throw new SchedulerTransportError("The request outcome is unknown. Retry it with the same protected command key.");
          }
          let body;
          try { body = await response.json(); } catch {
            if (response.ok) throw new SchedulerTransportError("The request outcome is unknown. Retry it with the same protected command key.");
            body = {};
          }
          if (!response.ok) throw new Error(body.error === "unauthorized" ? "Shopify Admin authentication was rejected. Refresh the page and try again." : body.error === "forbidden" ? "This Shopify staff account is not allowlisted for staging." : body.error === "schedule_conflict" ? "The schedule changed. Reloaded the latest state." : "The staging scheduler could not complete that request.");
          return body;
        }
        async function post(command) {
          const fingerprint = JSON.stringify(command);
          const pending = state.pending && state.pending.fingerprint === fingerprint
            ? state.pending
            : { command, fingerprint, key: idempotencyKey() };
          state.pending = pending;
          try {
            const result = await api("POST", pending.command, pending.key);
            state.pending = null;
            return result;
          } catch (error) {
            if (!(error instanceof SchedulerTransportError)) state.pending = null;
            throw error;
          }
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
          const save = element("button", "Save draft"); save.type = "submit";
          form.append(monthLabel, cutoffLabel, variantLabel, save);
          form.addEventListener("submit", async (event) => {
            event.preventDefault();
            const existing = currentSchedule(month.value);
            try {
              message("Saving staging draft…");
              await post({ action:"SAVE_DRAFT", shipMonth:month.value, cutoffAt:cutoff.value, merchantTimezone:"America/Chicago", variantId:variant.value, expectedRevision:existing ? existing.revision : null });
              await load();
              message("Draft saved.");
            } catch (error) { message(error instanceof Error ? error.message : "Draft was not saved.", true); await load().catch(() => {}); }
          });
          create.append(form); scheduler.append(create);
          if (state.pending) {
            const pending = element("section"); pending.className = "panel";
            pending.append(element("h2", "Confirm an uncertain request"));
            pending.append(element("p", "The previous request did not return a result. Retrying uses its original idempotency key and a fresh Shopify ID token."));
            const retry = element("button", "Retry pending request"); retry.type = "button";
            retry.addEventListener("click", async () => {
              try { message("Retrying protected staging request…"); await post(state.pending.command); await load(); message("Pending request confirmed."); } catch (error) { message(error instanceof Error ? error.message : "Pending request was not confirmed.", true); await load().catch(() => {}); }
            });
            pending.append(retry); scheduler.append(pending);
          }

          const list = element("section"); list.className = "panel"; list.append(element("h2", "Future-month schedules"));
          if (state.schedules.length === 0) list.append(element("p", "No authorized staging schedules are configured."));
          for (const schedule of state.schedules) {
            const row = element("article"); row.className = "schedule";
            row.append(element("strong", schedule.shipMonth + " · " + schedule.status));
            const details = element("p", "Included FOTM default: " + schedule.variantId + " · cutoff " + schedule.cutoffAt + " · revision " + schedule.revision); details.className = "meta"; row.append(details);
            const actions = element("div"); actions.className = "actions";
            if (schedule.status === "DRAFT") {
              const publish = element("button", "Publish this month"); publish.type = "button";
              publish.addEventListener("click", async () => {
                try { message("Publishing staging schedule…"); await post({ action:"PUBLISH", shipMonth:schedule.shipMonth, expectedRevision:schedule.revision }); await load(); message("Schedule published. Provision exact future cycles when ready."); } catch (error) { message(error instanceof Error ? error.message : "Schedule was not published.", true); await load().catch(() => {}); }
              }); actions.append(publish);
            }
            if (schedule.status === "PUBLISHED") {
              const provision = element("button", "Provision up to five cycles"); provision.type = "button"; provision.className = "secondary";
              provision.addEventListener("click", async () => {
                try { message("Provisioning bounded staging cycles…"); const result = await post({ action:"PROVISION", shipMonth:schedule.shipMonth, expectedScheduleRevision:schedule.revision }); await load(); message("Provisioned " + result.provisioning.configured + " cycle(s); conflicts " + result.provisioning.conflicted + (result.provisioning.mayHaveMore ? ". Run again for the next bounded batch." : ".")); } catch (error) { message(error instanceof Error ? error.message : "Cycles were not provisioned.", true); await load().catch(() => {}); }
              }); actions.append(provision);
            }
            row.append(actions); list.append(row);
          }
          scheduler.append(list);
        }
        async function load() {
          const result = await api("GET");
          state.schedules = Array.isArray(result.schedules) ? result.schedules : [];
          state.variants = Array.isArray(result.variants) ? result.variants : [];
          render(); scheduler.classList.remove("hidden");
        }
        load().then(() => message("Authenticated staging scheduler ready.")).catch((error) => message(error instanceof Error ? error.message : "Scheduler authentication failed.", true));
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

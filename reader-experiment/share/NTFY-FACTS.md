# ntfy.sh as measured

What the public relay actually does where the protocol depends on it. Measured by
`reader-experiment/tools/probe-ntfy.mjs` from a GitHub Actions runner on 2026-10-20
(run https://github.com/12twelve12hi/MHW/actions/runs/39373282479), and from the ntfy docs' limits table. The
multi-topic poll was measured on 2026-10-23 for the return lane (L2; runs
https://github.com/12twelve12hi/MHW/actions/runs/39916108184 and https://github.com/12twelve12hi/MHW/actions/runs/39917929098),
which also measured the rows above again with the same answers.

| Question | Answer on ntfy.sh |
|---|---|
| Largest attachment | **2,097,152 bytes (2 MiB) accepted; 2,097,153 refused** with `413`, `{"code":41301,"error":"attachment too large, or bandwidth limit reached; …"}` |
| Per-sender (IP) attachment total | The docs say 20 MB at a time (attachments expire after 3 h). The probe got 13 × 1.9 MB plus ~8 MB of earlier probes (~33 MB) accepted before a `413` with the **same code 41301**. Plan for 20 MB. |
| Telling "too big" from "quota full" | Impossible from the answer: both are `413` / `41301`. A frame we know is ≤ 2 MiB that gets 413 means the quota (or the daily bandwidth) is full: retry later. |
| Message vs attachment | A 4,096-byte text body was **already stored as an attachment** (so the effective message limit is below 4,096 bytes). Bodies of base64 ≤ 3,800 characters stayed messages in every live test. |
| `since=<unix time>` | **Inclusive**: `since=t` returns the message whose `time` is `t`; `since=t+1` does not. |
| `since=<message id>` | Returns the messages **after** that one, in the order the server stored them. |
| `since=<unknown or expired id>` | Returns **all** cached messages (not nothing). |
| When an attachment's `time` is set | When the **upload starts**: a 10 s upload started at T got `time` T+1, while a small message published at T+3 got T+3. |
| Visibility right after publishing | A poll made just after the slow upload finished **did not yet list it** (only the small message). Messages can appear in the cache shortly after their `time`, out of `time` order. So a time cursor can skip them; an id cursor (server order) does not. |
| Daily limits (docs) | 250 messages and 200 MB of bandwidth per visitor per day (attachment up/downloads and poll replays count). Phone and Daylight on the same Wi-Fi share one public IP. |
| Requests (docs) | Bursts of 60, then one every 5 s, per visitor. No rate-limit headers are sent. |
| CORS | Preflight `200`, `Access-Control-Allow-Origin: *`, `Allow-Headers: *` (includes `Authorization`), methods `GET, PUT, POST, PATCH, DELETE`. |
| Multi-topic poll `/{a},{b}/json?poll=1&since=…` | **One time cursor works for both topics.** `since=t` filters every topic by time (inclusive), the lines come in time order across the topics, and each line's `topic` names its topic; an attachment line on either topic has an `https://` URL. `since=<message id>` also works across the topics: it returns what was stored after that message, whichever topic it was on. So a return-lane device reads the shared return topic and its own in one request (LAB-PROTOCOL 2.4.1, `RETURN_POLL_COMBINED`). |
| Bandwidth over the daily limit | Not measured (it takes 200 MB). ntfy's code answers an **upload** over it with `413` `41301` (the same answer as a full attachment store, above) and a **download** over it with `429`; the mock relay does the same. |

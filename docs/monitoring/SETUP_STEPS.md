# Backend monitoring: setup steps

One step at a time, in order. Tick a step only when its check passes.
Full plan (why, cost, options): https://claude.ai/artifact/SBStgEZjNYNZzd3QWkomeB

Two phases: build and test **everything on staging first**. Start production only when staging has run stable.
AWS Mumbai (`ap-south-1`). Production cost ≈ $1.70/month, capped near $4; staging adds about the same while it runs.

## Already built (committed)

- `/api/health` checks the DB and Redis, returns 503 when either is down, `DEGRADED` when queue jobs fail.
- Redis port no longer published on the host; container log size capped; app `mem_limit: 3g`.
- JSON log lines on servers with `requestId`, path (no query string), status, ms, clinic, role, version.
- Servers log only failures (4xx/5xx) and requests slower than 2 s.
- Logged paths hide ids: `/patients/2daa30cf-.../appointments` → `/patients/:id/appointments` (`logPath` in `src/middlewear/requestLogger.ts`, 2026-11-02, not deployed yet).

## Decisions

| Decision | Choice | Date |
| --- | --- | --- |
| User ID in logs | Not logged. Clinic + role + time + requestId is enough | 2026-11-02 |
| HTTPS | nginx on the server, in front of the app | 2026-11-02 |
| Rollout | Full setup on staging first; production only after staging is stable | 2026-11-02 |
| Staging alarms after go-live | Keep or remove: decide when production is done | open |
| Alerts | SNS topic → Slack (AWS Chatbot) only, no email backup; one topic per environment | 2026-11-02 |
| Log retention | Prod 7 days, staging 1 day | 2026-11-02 |
| CloudWatch cap | $3 budget, blocks only `logs:PutLogEvents` | 2026-11-02 |
| CPU credits | Stay unlimited, alarm on extra charges, switch by hand | 2026-10-09 |
| Uptime check | Better Stack free plan (3-min checks, posts to Slack itself) instead of Route 53 ($1/month) | 2026-11-02 |

## Facts per environment

| | Staging | Production |
| --- | --- | --- |
| EC2 instance ID | `i-0b564b576922a65c1` | `i-09785dcccfc709cdf` |
| Server folder | `/home/ubuntu/infinity_medisetu/MediSetu_backend` | `/home/ubuntu/medisetu/Medi_Arogya_BE` |
| Containers | `cms-backend-app-stg`, `redis-stg` | `cms-backend-app`, `redis-prd` |
| App host port | 5002 | 5000 |
| Deploy | push to `staging`, recreates all services | push to `main`, recreates `app` only |
| Public health URL | ? | `https://infinitymedisetu.com/api/health` |
| RDS | same instance as prod | `db.t4g.micro`, 1 GB RAM |
| SNS topic | `ims-server-alerts` | `infinity-medisetu-prod-alerts` |
| Log group | `/infinity-medisetu/staging` | `/infinity-medisetu/prod` |
| Alarm name prefix | `stg-` | `prod-` |

## Step 0: questions
- [x] Drop the user ID in logs → drop
- [x] What handles HTTPS → nginx
- [x] Prod RDS class → `db.t4g.micro`
- [ ] Staging public health URL (`staging.` and `stg.infinitymedisetu.com` do not resolve)
- [x] Staging database → same RDS instance as prod (so S5 is skipped; P5 covers it)
- [x] User IDs and phone numbers in the other ~100 log lines → one filter in the logger (2026-11-02)
- [x] Alerts → Slack, through Amazon Q Developer (the AWS admin sets it up)
- [x] DB pool size → prod 50 + staging 20 = 70, under the shared ~80 (code changed 2026-11-02, test on staging first)
- [ ] For each RDS: `SHOW max_connections;` and allocated storage (GB)

## Step 1: code
- [x] Remove `userId` from `src/middlewear/requestLogger.ts`
- [x] Confirm the app logs `Server is running` on start (`src/server.ts`), used by the restart alarm
- [x] Commit (`30bd469`)

Found: about 100 other log calls still include user IDs or phone numbers (e.g. `Banner Cache MISS` has `userId`, `sns.service.ts` logs the phone number). Decision in step 0.

## Phase 1: staging

### S1. Deploy and lock down
- [x] Merge to `staging`: deployed as `staging-30bd469` (2026-11-02)
- [x] `docker port redis-stg` prints nothing = port closed
- [x] `curl -s localhost:5002/api/health` → `{"status":"OK"}`
- [x] `docker logs --tail=20 cms-backend-app-stg` → JSON lines with `version`
- [x] Staging security group: no inbound 6379, no 5002 from `0.0.0.0/0` (inbound is only 80, 443, and 22 from one IP; checked 2026-11-02)

### S2. Alert topic (AWS console, Mumbai)
- [x] SNS topic `ims-server-alerts` (Standard), Slack only, no email (admin, 2026-11-03)

### S3. Slack (Amazon Q Developer in chat applications, set up by admin 2026-11-03)
- [x] Slack workspace connected in AWS Chatbot (Amazon Q Developer in chat applications)
- [x] Private Slack channel `#infinity-medisetu-alert` created, `@Amazon Q` app invited
- [x] Channel configured in AWS by its channel ID, notification-only role
- [x] Topic `ims-server-alerts` attached to the channel (after S2)
- [x] Test message received

### S4. Server alarms (staging EC2)
- [x] Instance IAM role has the CloudWatch permissions (admin, 2026-11-03)
- [x] CloudWatch agent installed, running, starts on reboot; namespace `InfinityMediSetu/Staging` (admin, 2026-11-03)
  ```bash
  uname -m   # x86_64 → amd64, aarch64 → arm64 in the URL below
  wget https://amazoncloudwatch-agent.s3.amazonaws.com/ubuntu/amd64/latest/amazon-cloudwatch-agent.deb
  sudo dpkg -i -E ./amazon-cloudwatch-agent.deb
  sudo tee /opt/aws/amazon-cloudwatch-agent/etc/config.json > /dev/null <<'EOF'
  {
    "agent": { "metrics_collection_interval": 60, "run_as_user": "cwagent" },
    "metrics": {
      "append_dimensions": { "InstanceId": "${aws:InstanceId}" },
      "metrics_collected": {
        "mem": { "measurement": ["mem_used_percent"] },
        "disk": { "measurement": ["used_percent"], "resources": ["/"], "drop_device": true }
      }
    }
  }
  EOF
  sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json -s
  sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a status   # "status": "running"
  ```
- [x] Metrics arrive: `mem_used_percent` ~45%, `disk_used_percent` ~79% (2026-11-03)
- [ ] `StatusCheckFailed_System` → recover
- [ ] `StatusCheckFailed_Instance` → reboot
- [x] CPU > 80% for 10 min (`stg-cpu-high`, no action yet)
- [x] Memory ≥ 80% (`stg-memory-high`, admin, 2026-11-03)
- [ ] Disk > 85% (disk is already ~79%: clean up first, or it alarms at once)
- [ ] `CPUCreditBalance` < 50
- [ ] `CPUSurplusCreditsCharged` > 0

### S5. Database alarms: skipped (staging uses the prod RDS instance; done once in P5)
- [ ] `FreeStorageSpace` < 20% of allocated storage, 5 min
- [ ] `CPUUtilization` > 80% for 10 min
- [ ] `FreeableMemory` < 100 MB for 10 min (1 GB instance)
- [ ] `DatabaseConnections` > 75% of `max_connections` for 5 min
- [ ] Automated backups are on

### S6. Send logs to CloudWatch
- [ ] Personal data in log lines handled: `redact()` in `src/utils/logger.ts` masks user/patient ids, phones and emails on servers (code done 2026-11-02; check on staging that `Banner Cache MISS` shows `"userId":"[redacted]"`)
- [x] Log group `/infinity-medisetu/staging` created by hand, 1-day retention (2026-11-02)
- [x] Staging instance role can write to it (admin, 2026-11-03)
- [x] Code: staging app logging driver → `awslogs`, `mode: non-blocking` (`docker/docker-compose.staging.yml`; local override keeps json-file), 2026-11-03, not deployed yet
- [x] Deploy to staging, check lines arrive in the log group (2026-11-03; one stream per container, old ones expire after 1 day)
- [ ] Deny test: attach a deny on `logs:PutLogEvents` to the staging role, redeploy, check the API starts and serves; remove the deny

### S7. Log alarms (metric filters on `/infinity-medisetu/staging`)
Filters created 2026-11-02 in both log groups (namespace `InfinityMedisetu`, value 1, unit Count, no dimensions); `prod-` copies exist too.
- [x] Filter `stg-server-errors`: `{ $.type = "request" && $.status >= 500 }`
- [x] Filter `stg-error-lines`: `{ $.level = "error" && $.requestId NOT EXISTS }`
- [x] Filter `stg-app-starts`: `{ $.message = "Server is running*" }`
- `[Health] DEGRADED`: not needed, the Better Stack keyword check covers it
- Alarms below need the first log lines (S6), because a metric appears only after its first data point:
- [x] `stg-server-errors` > 10 in 5 min (2026-11-03)
- [x] `stg-error-lines` ≥ 1 in 5 min (2026-11-03)
- [x] `stg-app-starts` > 2 in 1 hour (restarts) (2026-11-03)
- All three: missing data = good; In alarm + OK → `ims-server-alerts` via topic ARN (the user can't list SNS topics, so pick "Use topic ARN")

### S8. Uptime check: skipped (staging has no public address; Better Stack covers prod, see below)

### S9. Final test
- [x] Real test: CPU stress on staging (`yes` x2, ~12 min) fired `stg-cpu-high` → Slack (2026-11-03). `set-alarm-state` also works for later tests.
- [x] Slack received it, and the "OK" message after (2026-11-03)

### S10. Run stable
- [ ] A few days with no false alarms; tune thresholds that fired for no reason
- [ ] Go / no-go for production

## Phase 2: production

Same steps with production values from the table above. Start only after S10.

### P1. Deploy and lock down
- [x] Deploy script fixed: SSM runs as root, so `git pull` now runs as ubuntu (`sudo -u ubuntu -H`) and the deploy stops if it fails (`.github/workflows/main.yml`, staging + prod, 2026-11-03). Before, a failed pull went unnoticed and server files stayed old.
- [x] Code: prod app logging → `awslogs` to `/infinity-medisetu/prod`, non-blocking (`docker/docker-compose.prod.yml`, 2026-11-03)
- [ ] Before merging: prod server `git status` clean or only known local commits; prod role has `CloudWatchAgentServerPolicy` (else the app won't start with awslogs)
- [ ] Merge to `main` (the pipeline deploys it)
- [ ] Recreate Redis once on the server, at a quiet time (prod deploy recreates `app` only):
  ```bash
  cd /home/ubuntu/medisetu/Medi_Arogya_BE
  docker compose -f docker/docker-compose.prod.yml up -d redis
  docker port redis-prd               # prints nothing = port closed
  curl -s localhost:5000/api/health   # {"status":"OK"}
  ```
- [ ] Security group: no inbound 6379, no 5000 from `0.0.0.0/0`; keep 80/443 for nginx (5000 already unreachable from outside, checked 2026-11-02)

### P2–P9. Repeat S2–S9 for production
- [ ] P2 topic `infinity-medisetu-prod-alerts`
- [ ] P3 Slack subscribed to it
- [ ] P4 server alarms (`prod-` prefix)
- [ ] P5 RDS alarms for `db.t4g.micro`: free memory < 100 MB, connections > 75% of `max_connections` (about 60)
- [ ] P6 log group `/infinity-medisetu/prod` (created 2026-11-02, 7-day retention), `awslogs` non-blocking (no deny test on prod; done on staging)
- [ ] P7 log alarms (filters `prod-server-errors`, `prod-error-lines`, `prod-app-starts` already created)
- P8 uptime check: done in Better Stack (below)
- [ ] P9 final test

### P10. Cost limits
- [ ] $3 CloudWatch budget, alerts at 50/80/100%, deny `logs:PutLogEvents` at 100%
- [ ] Free EC2 spend alert

## Uptime check (Better Stack, free)

Runs from outside, like a clinic. Posts to `#infinity-medisetu-alert` itself (no SNS or Amazon Q needed).

- [x] Better Stack account (Uptime) and Slack integration connected
- [x] `/invite @Better Stack` in `#infinity-medisetu-alert` (private channel)
- [x] Monitor `prod-uptime`: `https://infinitymedisetu.com/api/health`, every 3 min
- [x] Alert when the URL doesn't contain keyword `"status":"OK"` (also catches `DEGRADED` and 503)
- SSL and domain expiration alerts: paid plan only, skipped. "SSL/TLS verification: On" still alerts the moment the certificate expires.
- [ ] Certbot auto-renew is active on the server: `systemctl list-timers | grep certbot`
- [ ] Confirmation period 1–2 min (no alert for one slow moment)
- [x] Monitors named: `Prod – API health`, `Prod – Website` (`/`), `Prod – Socket.io` (`/socket.io/?EIO=4&transport=polling`, keyword `sid`), `Staging – API health`
- [ ] Test: monitor on `https://infinitymedisetu.com/api/this-does-not-exist` → alert reaches Slack → delete it

## Later
- [ ] CloudWatch alarm for failed background jobs: metric filter `prod-cron-failures` on log group `/infinity-medisetu/prod`, pattern `"[Cron:" "Failed"`, alarm when ≥ 1 in 15 min → SNS → Slack. No code change; the job runner already logs this line. Complements the Super Admin **Security → System jobs** page (business view, Run now) — this one is for DevOps.
- [ ] Better Stack heartbeats for cron jobs: optional now; the System jobs page already flags a job that missed its run (`cron_runs`, daily billing email). Add only if an alert outside the app is wanted when the whole server is down
- [ ] Decide: keep or remove staging alarms
- [ ] 401 spike alarm, after one week of prod logs shows the normal number
- [ ] Short runbook: who responds and what they check first
- Frontend error reporting: planned separately

## Notes

- HTTPS certificate and domain expiry are watched by Better Stack. To check renewal by hand: `sudo certbot certificates`.
- DB pool fixed in `src/configurations/dbConfig.ts`: prod 50, staging 20 (one shared instance, ~80 max). Timeouts now use postgres.js names (`idle_timeout`, `connect_timeout`, `max_lifetime`), so idle connections close after 10 s. Check on staging: `SELECT count(*) FROM pg_stat_activity;` stays under 80.

## How deploys work today

From `.github/workflows/main.yml`:

1. Push to `staging` or `main` runs build and tests. (`vX.Y.Z` tags run build and tests only, no deploy.)
2. The image goes to Docker Hub as `staging-<commit>` or `prod-<commit>`; that tag is the `version` in every log line.
3. GitHub runs a script on the server through AWS Systems Manager: `git pull`, pull the image, then `docker compose up -d` (staging: all services; prod: `app` only).
4. It waits for the app to be healthy, removes old images, and emails the result.

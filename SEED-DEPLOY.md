# Seed the deployed environment (curl)

`db:seed` writes to the LOCAL DynamoDB only. To register the same demo cast in the
**deployed** API (which uses the deployed DynamoDB), use these curls. Replace
`<API_BASE>` with your deployed API Gateway URL (see the README "Deployed test URLs"),
e.g. `https://whlw0bdtn6.execute-api.us-east-1.amazonaws.com/dev`.

Set it once:

```bash
export API_BASE="<API_BASE>"        # this env; use `https://whlw0bdtn6.execute-api.us-east-1.amazonaws.com/dev`
```

## The 4 demo users (same cast as `db:seed`)

```bash
curl -s -w " HTTP %{http_code}\n" -X POST "$API_BASE/api/users" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ruth","email":"ruth@example.com","position":"Manager"}'

curl -s -w " HTTP %{http_code}\n" -X POST "$API_BASE/api/users" \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana","email":"ana@example.com","position":"Analyst"}'

curl -s -w " HTTP %{http_code}\n" -X POST "$API_BASE/api/users" \
  -H "Content-Type: application/json" \
  -d '{"name":"Sven","email":"sven@example.com","position":"Director"}'

curl -s -w " HTTP %{http_code}\n" -X POST "$API_BASE/api/users" \
  -H "Content-Type: application/json" \
  -d '{"name":"Luca","email":"luca@example.com","position":"Compliance"}'
```

Expected: `201` for the four. A repeat returns `409` (email already registered — idempotent-ish).

## Verify

```bash
curl -s "$API_BASE/api/users" | python3 -m json.tool
# → the 4 users: Ruth (requester) + Ana/Sven/Luca (approvers)
```

## How to drive the deployed demo from here (frontend)

1. Open the requester panel: `https://d2w6pt5r1wzlum.cloudfront.net/requester`
2. Create a purchase request (title, amount, requester = `ruth@example.com`, 3 approvers).
3. Read the approval links + OTPs from the deployed inbox:
   `$API_BASE/mock-mail` (filter per approver: `?to=ana@example.com`).
4. Open an approval link (should point at the host CloudFront `https://d2w6pt5r1wzlum.cloudfront.net/approve?request_id=...&approver_token=...`
   — enabled by setting `APPROVER_BASE_URL` to the host CloudFront URL and redeploying the backend).
5. Enter the OTP, approve ×3 → COMPLETED → download the PDF (S3 evidence).

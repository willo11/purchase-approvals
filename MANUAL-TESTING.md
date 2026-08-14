# Manual Testing — Purchase Approvals

Guía para probar el sistema por API con `curl`, sin levantar AWS. Todo corre local
(DynamoDB en Docker + `serverless offline` en `:4000`). Se actualiza a medida que
se suman PRs.

> Estado actual: **PR #1 — user-registry (backend API)**. Frontend aún NO está
> conectado al backend (llega en PR #6 requester-panel y PR #7 approver-flow),
> así que por ahora el testing manual es 100% backend por `curl`.

---

## Preparación (una vez)

### 1. Credenciales → `.env`

Copiá el template y ajustalo si hace falta:

```bash
cp backend/.env.example backend/.env   # valores locales ya listos por defecto
```

El backend carga `backend/.env` automáticamente (serverless-dotenv-plugin).
Variables que te importan:

| Variable | Valor local | Nota |
|----------|-------------|------|
| `DYNAMODB_LOCAL` | `http://localhost:8000` | Apunta a DynamoDB en Docker. Borralo/vaciarlo para apuntar a AWS real en deploy. |
| `TABLE_NAME` | `purchase-approvals-dev` | Tabla single-table. Debe existir localmente. |
| `AWS_ACCESS_KEY_ID` / `SECRET` | `local-dummy` | Solo local. Nunca credenciales reales acá. |

### 2. Levantar DynamoDB local + crear la tabla

```bash
pnpm -C backend run db:up   # levanta dynamodb-local en :8000 (Docker)

aws --endpoint-url http://localhost:8000 dynamodb create-table \
  --table-name purchase-approvals-dev \
  --attribute-definitions AttributeName=PK,AttributeType=S AttributeName=SK,AttributeType=S AttributeName=gsi1pk,AttributeType=S AttributeName=gsi1sk,AttributeType=S \
  --key-schema AttributeName=PK,KeyType=HASH AttributeName=SK,KeyType=RANGE \
  --global-secondary-indexes IndexName=GSI1,KeySchema=AttributeName=gsi1pk,KeyType=HASH,KeySchema=AttributeName=gsi1sk,KeyType=RANGE,Projection=ProjectionType=ALL \
  --billing-mode PAY_PER_REQUEST
```

> ¿No tenés `aws` CLI? Anteponé credenciales dummy: `AWS_ACCESS_KEY_ID=x AWS_SECRET_ACCESS_KEY=x aws ...`.

### ¿Por qué hay que crear la tabla a mano (solo localmente)?

DynamoDB **no autoprovisiona tablas al escribirles**: las creás vos (o la infraestructura).
La diferencia según dónde corras:

| Entorno | Quién crea la tabla | ¿A mano? |
|---------|--------------------|----------|
| **AWS (deploy)** | `sls deploy` → **CloudFormation** lee `serverless.yml` y crea `PurchaseApprovalsTable` (con GSI1 + TTL) automáticamente | No |
| **Local (serverless-offline)** | Nadie. `serverless-offline` corre las Lambdas pero **NO provisiona los recursos de CloudFormation** | Sí, con el `aws create-table` de arriba |

Además, el contenedor `amazon/dynamodb-local` corre **en memoria** (este compose no usa
`-dbPath` ni monta volumen), así que la tabla local desaparece al reiniciar el contenedor.
Re-creala con el comando de arriba tras cada `db:up`. (Nota: los tests de integración
crean su **propia** tabla descartable, así que esa no te sirve para estos curls.)

## Arrancar el backend

```bash
pnpm -C backend run dev        # serverless offline en :4000 (usa el .env)
```

Listo: el API queda en `http://localhost:4000/dev`.

---

## Endpoints para probar

### PR #1 — user-registry (`/api/usuarios`)

```bash
# Smoke — ¿está vivo? → {"status":"ok"}
curl http://localhost:4000/dev/health

# 1. Crear empleado → 201 + User {name,email,cargo}
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/usuarios \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana","email":"ana@example.com","cargo":"Analista"}'

# 2. Email duplicado → 409
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/usuarios \
  -H "Content-Type: application/json" \
  -d '{"name":"Otra","email":"ana@example.com"}'

# 3. Email inválido → 400
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/usuarios \
  -H "Content-Type: application/json" \
  -d '{"name":"Ana","email":"no-soy-email"}'

# 4. Nombre vacío → 400
curl -s -w "\nHTTP:%{http_code}\n" -X POST http://localhost:4000/dev/api/usuarios \
  -H "Content-Type: application/json" \
  -d '{"name":"","email":"b@example.com"}'

# 5. Listar empleados → 200, en orden de creación
curl -s -w "\nHTTP:%{http_code}\n" http://localhost:4000/dev/api/usuarios
```

**Resultado esperado**: `201 → 409 → 400 → 400 → 200 (con los usuarios registrados)`.

### PR #X — (pendiente)

Se agregan acá los curls de los próximos PRs cuando lleguemos (purchase-request,
approver-otp, approval-signature, pdf-evidence, requester-panel, approver-flow).

---

## Contexto de Clean Code (para sustentar)

El flujo verificado por estos curls es `HTTP → handler → use case → port → DynamoDB`:

```
api/handlers/userRegistry.ts          → HTTP (request/response)
   ▼ llama
application/RegisterUser.ts            → caso de uso (reglas de negocio)
   ▼ depende del PORT (interfaz)
application/ports/UserRepository.ts   → contrato, no implementación
   ▲ implementa
infrastructure/DynamoDbUserRepository.ts → adapter (única capa que conoce DynamoDB)
```

- **Dedupe atómico**: `PutItem` condicional (`attribute_not_exists(PK)`) → email
  duplicado se rechaza con 409 sin race condition (no es get-then-put).
- **Listado en orden**: query por GSI1 (`gsi1sk = createdAt`, `ScanIndexForward: true`).
- **`domain` sin framework**: `User`/`Email` no importan nada externo.

## Check in

- [ ] `backend/.env` creado desde `.env.example`
- [ ] `dynamodb-local` levantado (`db:up`) y tabla `purchase-approvals-dev` creada
- [ ] `pnpm -C backend run dev` responde en `:4000`
- [ ] Los 5 curls del PR #1 devuelven `201 → 409 → 400 → 400 → 200`
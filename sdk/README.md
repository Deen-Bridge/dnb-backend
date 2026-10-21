# DeenBridge SDK

Auto-generated TypeScript client SDK for the [DeenBridge Backend API](https://dnb-backend-api.onrender.com).

## Regenerate

```bash
npm run generate   # from the sdk/ directory
# — or —
bash ../scripts/generate-sdk.sh   # from anywhere in the repo
```

Requires Docker.

## Usage

```ts
import { Configuration, AuthApi, CoursesApi } from "@deenbridge/sdk";

const config = new Configuration({
  basePath: "https://dnb-backend-api.onrender.com",
  apiKey: () => localStorage.getItem("token") ?? "",
});

const auth = new AuthApi(config);
const courses = new CoursesApi(config);

const { data: me } = await auth.getMe();
const { data: list } = await courses.listCourses();
```

## Development

The generated code lives in `sdk/src/`. It is produced by
[openapi-generator](https://openapi-generator.tech/) using the `typescript-fetch`
generator against the root `openapi.yaml`.

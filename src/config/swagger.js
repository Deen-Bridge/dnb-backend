import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Loads the OpenAPI specification from the repository root and prepares
 * Swagger UI options used by the /api-docs router.
 */
const SPEC_PATH = path.resolve(__dirname, "../../openapi.yaml");
const BRANDING_CSS_PATH = path.resolve(
  __dirname,
  "../../public/swagger-ui/deenbridge.css"
);

function loadSwaggerSpec() {
  const raw = fs.readFileSync(SPEC_PATH, "utf8");
  return yaml.load(raw);
}

function loadBrandingCss() {
  try {
    return fs.readFileSync(BRANDING_CSS_PATH, "utf8");
  } catch {
    return "";
  }
}

export const swaggerSpec = loadSwaggerSpec();

export const swaggerUiOptions = {
  customSiteTitle: "Deen-Bridge API",
  // Keep the Authorize dialog contents across page reloads.
  persistAuthorization: true,
  customCss: loadBrandingCss(),
  swaggerOptions: {
    displayRequestDuration: true,
    filter: true,
  },
};

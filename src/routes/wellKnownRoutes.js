import { buildStellarToml } from "../services/stellar/stellarTomlService.js";

export const getStellarToml = (req, res) => {
  res
    .status(200)
    .set("Content-Type", "text/toml; charset=utf-8")
    .set("Access-Control-Allow-Origin", "*")
    .send(buildStellarToml());
};

import { createApp } from "./app.ts";
import { config } from "./config.ts";

const app = createApp();

app.listen({
  port: config.port,
  hostname: config.host,
});

console.log(`cursor-sdk-server listening on http://${config.host}:${config.port}/v1/responses`);

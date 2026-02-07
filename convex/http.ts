import { httpRouter } from "convex/server";
import { handleTelegramWebhook } from "./telegram/commandHandler";

const http = httpRouter();

http.route({
  path: "/telegram/webhook",
  method: "POST",
  handler: handleTelegramWebhook,
});

export default http;

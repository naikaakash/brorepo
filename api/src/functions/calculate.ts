import { app } from "@azure/functions";
import { handleCalculate } from "../http.js";

app.setup({ enableHttpStream: true });

app.http("calculate", {
  authLevel: "anonymous",
  route: "calculate",
  handler: handleCalculate
});

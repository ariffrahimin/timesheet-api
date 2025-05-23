import { Hono } from "hono";
import { cors } from "hono/cors";
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";
import * as path from "path";

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

// Types
interface ClockRecord {
  id?: number;
  email: string;
  clock_in_time: string;
  clock_out_time?: string;
  created_at?: string;
  updated_at?: string;
}

interface ApiResponse<T = any> {
  success: boolean;
  message: string;
  data?: T;
}

const app = new Hono();

// Enable CORS
app.use("*", cors());

// Serve Swagger UI
app.get("/docs", (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Timesheet API Documentation</title>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
      </head>
      <body>
        <div id="swagger-ui"></div>
        <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
        <script>
          SwaggerUIBundle({
            url: "/openapi.yaml",
            dom_id: '#swagger-ui',
            presets: [
              SwaggerUIBundle.presets.apis,
              SwaggerUIBundle.SwaggerUIStandalonePreset
            ]
          })
          window.ui = ui
        </script>
      </body>
    </html>
  `);
});

// Serve OpenAPI specification
app.get("/openapi.yaml", (c) => {
  const openapiPath = path.join(__dirname, "../openapi.yaml");
  const openapiContent = fs.readFileSync(openapiPath, "utf8");
  return c.text(openapiContent, {
    headers: {
      "Content-Type": "application/yaml"
    }
  });
});

// Serve OpenAPI specification as JSON
app.get("/openapi.json", (c) => {
  const openapiPath = path.join(__dirname, "../openapi.yaml");
  const openapiContent = fs.readFileSync(openapiPath, "utf8");
  
  // Convert YAML to JSON
  const jsYaml = require('js-yaml');
  const jsonContent = jsYaml.load(openapiContent);
  
  return c.json(jsonContent);
});

// Serve OpenAPI specification
app.get("/openapi.json", (c) => {
  return c.json(require("../openapi.yaml"));
});

// Middleware to validate email
const validateEmail = async (c: any, next: any) => {
  const body = await c.req.json();
  const { email } = body;

  if (!email || !email.includes("@")) {
    return c.json(
      {
        success: false,
        message: "Valid email is required",
      },
      400
    );
  }

  c.set("email", email);
  await next();
};

// Clock In Endpoint
app.post("/api/clock-in", validateEmail, async (c: any) => {
  try {
    const email = c.get("email");

    // Check if user is already clocked in
    const { data: existingRecord, error: checkError } = await supabase
      .from("clock_records")
      .select("*")
      .eq("email", email)
      .is("clock_out_time", null)
      .single();

    if (existingRecord) {
      return c.json({
        success: false,
        message: "User is already clocked in",
        data: existingRecord,
      }, 400);
    }

    if (checkError && checkError.code !== "PGRST116") {
      throw checkError;
    }

    // Create new clock-in record
    const { data, error } = await supabase
      .from("clock_records")
      .insert([
        {
          email,
          clock_in_time: new Date().toISOString(),
        },
      ])
      .select()
      .single();

    if (error) throw error;

    return c.json({
      success: true,
      message: "Successfully clocked in",
      data,
    });
  } catch (error) {
    console.error("Clock-in error:", error);
    return c.json({
      success: false,
      message: "Failed to clock in",
    }, 500);
  }
});

// Clock Out Endpoint
app.post("/api/clock-out", validateEmail, async (c: any) => {
  try {
    const email = c.get("email");

    // Find active clock-in record
    const { data: activeRecord, error: findError } = await supabase
      .from("clock_records")
      .select("*")
      .eq("email", email)
      .is("clock_out_time", null)
      .single();

    if (findError && findError.code !== "PGRST116") {
      throw findError;
    }

    if (!activeRecord) {
      return c.json(
        {
          success: false,
          message: "No active clock-in found for this user",
        },
        400
      );
    }

    // Update clock-out time
    const clockOutTime = new Date().toISOString();
    const { data, error } = await supabase
      .from("clock_records")
      .update({ clock_out_time: clockOutTime })
      .eq("id", activeRecord.id)
      .select()
      .single();

    if (error) throw error;

    return c.json({
      success: true,
      message: "Successfully clocked out",
      data,
    });
  } catch (error) {
    console.error("Clock-out error:", error);
    return c.json({
      success: false,
      message: "Failed to clock out",
    }, 500);
  }
});

// Check Status Endpoint
app.get("/api/status/:email", async (c: any) => {
  try {
    const email = c.req.param("email");

    // Find active clock-in record
    const { data: activeRecord, error: findError } = await supabase
      .from("clock_records")
      .select("*")
      .eq("email", email)
      .is("clock_out_time", null)
      .single();

    if (findError && findError.code !== "PGRST116") {
      throw findError;
    }

    if (activeRecord) {
      return c.json({
        success: true,
        status: "clocked-in",
        data: activeRecord,
      });
    }

    // Find latest clock-out record
    const { data: latestRecord, error: latestError } = await supabase
      .from("clock_records")
      .select("*")
      .eq("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (latestError && latestError.code !== "PGRST116") {
      throw latestError;
    }

    return c.json({
      success: true,
      status: "clocked-out",
      data: latestRecord,
    });
  } catch (error) {
    console.error("Status check error:", error);
    return c.json({
      success: false,
      message: "Failed to check status",
    }, 500);
  }
});

// Health Check Endpoint
app.get("/health", (c: any) => {
  return c.json({
    success: true,
    message: "API is running",
    timestamp: new Date().toISOString(),
  });
});

export default {
  port: process.env.PORT || 3000,
  fetch: app.fetch,
};
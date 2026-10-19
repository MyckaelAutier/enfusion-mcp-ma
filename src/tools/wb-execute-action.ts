import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WorkbenchClient } from "../workbench/client.js";
import { formatConnectionStatus, requireEditMode } from "../workbench/status.js";

// Menu paths that are known-safe for read-only or non-destructive use
const BLOCKED_MENU_PREFIXES = [
  "File,Close",
  "File,New",
  "File,Exit",
  "File,Quit",
];

export function registerWbExecuteAction(server: McpServer, client: WorkbenchClient): void {
  server.registerTool(
    "wb_execute_action",
    {
      description:
        "Execute any Workbench menu action by its menu path. Use comma-separated path segments to identify the action (e.g., 'Tools,Reload Scripts' or 'File,Save'). " +
        "Some destructive actions (File,Close; File,New; File,Exit) are blocked for safety.",
      inputSchema: {
        menuPath: z
          .string()
          .describe(
            "Comma-separated menu path (e.g., 'Tools,Reload Scripts', 'File,Save', 'Edit,Undo')"
          ),
        module: z
          .enum(["WorldEditor", "ScriptEditor", "ResourceManager", "AnimEditor", "ParticleEditor", "BehaviorEditor", "AudioEditor", "LocalizationEditor"])
          .default("WorldEditor")
          .describe("Workbench module whose menu holds the action (default WorldEditor)"),
      },
    },
    async ({ menuPath, module }) => {
      try {
        // Block known-destructive menu paths
        const normalizedPath = menuPath.trim();
        for (const blocked of BLOCKED_MENU_PREFIXES) {
          if (normalizedPath.startsWith(blocked)) {
            return {
              content: [{
                type: "text" as const,
                text: `**Blocked:** "${menuPath}" is a destructive action and cannot be executed via this tool. Perform it manually in Workbench.${formatConnectionStatus(client)}`,
              }],
            };
          }
        }

        // Mutating actions require edit mode
        const modeErr = requireEditMode(client, `execute menu action "${menuPath}"`);
        if (modeErr) {
          return { content: [{ type: "text" as const, text: modeErr + formatConnectionStatus(client) }] };
        }
        const result = await client.call<Record<string, unknown>>("EMCP_WB_ExecuteAction", {
          menuPath,
          module,
        });
        if (!result.executed) {
          return {
            content: [{ type: "text" as const, text: `**Action not executed** — ${module} has no enabled menu item "${menuPath}".${formatConnectionStatus(client)}` }],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `**Action Executed**\n\nMenu path: ${menuPath}${result.message ? `\n${result.message}` : ""}${result.result ? `\nResult: ${JSON.stringify(result.result)}` : ""}${formatConnectionStatus(client)}`,
            },
          ],
        };
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error executing action "${menuPath}": ${msg}${formatConnectionStatus(client)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );
}

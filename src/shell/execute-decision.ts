import chalk from 'chalk';
import * as readline from 'node:readline/promises';
import { listAgents } from '../agents/store.js';
import { loadConfig } from '../config/load-config.js';
import { cmdNetworkStatus } from '../commands/network.js';
import { cmdToolsDelete, cmdToolsDeleteAll, cmdToolsList, cmdToolsSearch, isDeleteAllToolsQuery, previewDeleteAllTools } from '../commands/tools.js';
import { checkExecutionGate } from '../runtime/execution-gate.js';
import { runTask } from '../runtime/run-task.js';
import { writeTrace } from '../runtime/trace.js';
import type { AgentDecision } from '../brain/action-schema.js';
import type { ShellContext } from './commands.js';

const MIN_EXECUTION_CONFIDENCE = 0.55;

function printLine(message: string, color: 'cyan' | 'yellow' | 'gray' = 'cyan'): void {
  console.log(chalk[color](`  ${message}`));
}

async function askDeleteApproval(toolName: string, agentName: string): Promise<boolean> {
  const deleteAll = isDeleteAllToolsQuery(toolName);
  console.log();
  if (deleteAll) {
    const preview = await previewDeleteAllTools({ agent: agentName });
    printLine(`Agent wants to delete ALL tools from ${agentName}.`, 'yellow');
    printLine(`This will remove ${preview.toolNames.length} tool(s) and ${preview.experienceCount} experience record(s).`, 'gray');
    for (const name of preview.toolNames.slice(0, 10)) {
      printLine(`- ${name}`, 'gray');
    }
    if (preview.toolNames.length > 10) printLine(`...and ${preview.toolNames.length - 10} more`, 'gray');
  } else {
    printLine(`Agent wants to delete tool "${toolName}" from ${agentName}.`, 'yellow');
    printLine('This removes the local registry entry, tool blob, and matching experience records.', 'gray');
  }

  if (!process.stdin.isTTY) {
    printLine('Delete blocked: approval requires an interactive terminal.', 'yellow');
    console.log();
    return false;
  }

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const approvalText = deleteAll ? 'DELETE ALL' : 'DELETE';
    const answer = await rl.question(chalk.yellow(`  Type ${approvalText} to approve: `));
    const approved = answer.trim() === approvalText;
    if (!approved) {
      printLine('Delete cancelled.', 'yellow');
      console.log();
    }
    return approved;
  } finally {
    rl.close();
  }
}

async function printStatus(ctx: ShellContext): Promise<void> {
  const config = await loadConfig();
  const agents = await listAgents();

  console.log(chalk.bold('\n  Pan Status:'));
  console.log(`  Agent:       ${chalk.green(ctx.agentName)}`);
  console.log(`  Storage:     ${chalk.cyan(config.storageMode)}`);
  console.log(`  AXL:        ${config.axl.enabled ? chalk.green(`enabled (port ${config.axl.port})`) : chalk.red('disabled')}`);
  console.log(`  ENS:        ${config.ens.enabled ? chalk.green('enabled') : chalk.red('disabled')}`);
  console.log(`  Decision:   ${chalk.cyan(config.decision.provider)}${config.decision.provider === 'openrouter' ? chalk.gray(` (${config.decision.openRouterModel})`) : ''}`);
  console.log(`  Agents:      ${chalk.gray(String(agents.length))}`);
  console.log();
}

async function printAgents(ctx: ShellContext): Promise<void> {
  const agents = await listAgents();
  if (agents.length === 0) {
    printLine('No agents found. Run pan agent create <name>.', 'yellow');
    return;
  }

  console.log(chalk.bold('\n  Agents:'));
  for (const agent of agents) {
    const current = agent.name === ctx.agentName ? chalk.green(' (active)') : '';
    console.log(`  ${chalk.cyan(agent.name)}${current}`);
    if (agent.description) console.log(chalk.gray(`    ${agent.description}`));
  }
  console.log();
}

async function switchAgent(name: string | null | undefined, ctx: ShellContext): Promise<void> {
  const target = name?.trim();
  if (!target) {
    printLine('Which agent should I switch to?', 'yellow');
    return;
  }

  const agents = await listAgents();
  const exists = agents.some((agent) => agent.name === target);
  if (!exists) {
    printLine(`Agent "${target}" not found.`, 'yellow');
    return;
  }

  ctx.setAgent(target);
  printLine(`Switched to agent: ${target}`);
}

function printPlan(decision: AgentDecision): void {
  const plan = decision.userResponse ?? decision.task;
  if (!plan) {
    printLine('I need a bit more detail before I can make a useful plan.', 'yellow');
    return;
  }
  console.log();
  console.log(plan.split('\n').map((line) => `  ${line}`).join('\n'));
  console.log();
}

export async function executeDecision(input: string, decision: AgentDecision, ctx: ShellContext): Promise<void> {
  await writeTrace({
    type: 'decision',
    agentName: ctx.agentName,
    input,
    intent: decision.intent,
    action: decision.action,
    confidence: decision.confidence,
    task: decision.task ?? null,
  }).catch(() => undefined);

  if (decision.intent === 'unsafe_or_invalid') {
    console.log();
    printLine(decision.userResponse ?? 'I cannot help with that request.', 'yellow');
    console.log();
    return;
  }

  switch (decision.action) {
    case 'respond_to_user':
      console.log();
      printLine(decision.userResponse ?? 'I am Pan Agents, your autonomous CLI assistant.');
      console.log();
      return;
    case 'ask_clarifying_question':
      console.log();
      printLine(decision.clarificationQuestion ?? 'What should I do exactly?', 'yellow');
      console.log();
      return;
    case 'list_tools':
      await cmdToolsList({ agent: ctx.agentName });
      return;
    case 'find_tool':
      if (decision.toolQuery) {
        await cmdToolsSearch(decision.toolQuery, { agent: ctx.agentName });
      } else {
        await cmdToolsList({ agent: ctx.agentName });
      }
      return;
    case 'delete_tool': {
      const toolName = decision.toolQuery ?? (typeof decision.params?.toolName === 'string' ? decision.params.toolName : null);
      if (!toolName) {
        console.log();
        printLine('Which tool should I delete?', 'yellow');
        console.log();
        return;
      }

      if (await askDeleteApproval(toolName, ctx.agentName)) {
        if (isDeleteAllToolsQuery(toolName)) {
          await cmdToolsDeleteAll({ agent: ctx.agentName });
        } else {
          await cmdToolsDelete(toolName, { agent: ctx.agentName });
        }
      }
      return;
    }
    case 'get_status':
      await printStatus(ctx);
      return;
    case 'list_agents':
      await printAgents(ctx);
      return;
    case 'switch_agent':
      await switchAgent(decision.agentName, ctx);
      return;
    case 'plan_task':
      printPlan(decision);
      return;
    case 'use_or_create_tool': {
      const task = decision.task ?? input;
      const gate = checkExecutionGate(task);
      if (!gate.allowed) {
        console.log();
        printLine(gate.response);
        console.log();
        return;
      }

      if (decision.confidence < MIN_EXECUTION_CONFIDENCE) {
        console.log();
        printLine('I need a more specific task.', 'yellow');
        console.log();
        return;
      }

      console.log();
      await runTask(task, ctx.agentName);
      console.log();
      return;
    }
  }
}

export async function executeSlashStatus(ctx: ShellContext): Promise<void> {
  await printStatus(ctx);
}

export async function executeSlashAgents(ctx: ShellContext): Promise<void> {
  await printAgents(ctx);
}

export async function executeSlashSwitchAgent(name: string, ctx: ShellContext): Promise<void> {
  await switchAgent(name, ctx);
}

export async function executeSlashNetwork(): Promise<void> {
  await cmdNetworkStatus();
}

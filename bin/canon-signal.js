#!/usr/bin/env node

const args = process.argv.slice(2)
const command = args[0]

/**
 * Loads a CLI module from dist/, trying ESM first then falling back to CJS.
 * Returns a promise that resolves to the loaded module.
 */
async function loadCli(esmPath, cjsPath) {
  try {
    return await import(esmPath)
  } catch {
    return require(cjsPath)
  }
}

/**
 * Parses --flag and --flag value style arguments. Returns a simple object
 * with boolean flags and string values.
 */
function parseFlags(args) {
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg.startsWith('--')) continue
    const name = arg.slice(2)
    const next = args[i + 1]
    if (next && !next.startsWith('--')) {
      flags[name] = next
      i++
    } else {
      flags[name] = true
    }
  }
  return flags
}

function printHelp() {
  console.log('canon-signal CLI')
  console.log()
  console.log('Commands:')
  console.log('  create          Scaffold a signal.ts setup file')
  console.log('  install-docs    Install agent documentation into .canon-signal/')
  console.log('  tutorial        Print or copy the human-facing HTML tutorial')
  console.log('  inspect         Query recent traces from a JSONL file')
  console.log('  report-issue    Open a pre-filled GitHub issue in your browser')
  console.log()
  console.log('Usage:')
  console.log('  npx canon-signal create')
  console.log('  npx canon-signal install-docs            # write to ./.canon-signal/')
  console.log('  npx canon-signal install-docs --force    # overwrite existing')
  console.log('  npx canon-signal install-docs --no-agents-md  # skip root AGENTS.md')
  console.log('  npx canon-signal tutorial                # print path to bundled tutorial')
  console.log('  npx canon-signal tutorial --copy         # copy tutorial to ./')
  console.log('  npx canon-signal tutorial --copy --out docs/tutorial.html')
  console.log('  npx canon-signal inspect --file traces.jsonl --last 5 --errors')
  console.log('  npx canon-signal inspect --file traces.jsonl --trace <traceId>')
  console.log('  npx canon-signal inspect --file traces.jsonl --format json')
  console.log('  npx canon-signal report-issue                              # generic bug report')
  console.log('  npx canon-signal report-issue "Pretty-console renders weird"')
  console.log('  npx canon-signal report-issue "Add Koa middleware" --type feature')
  console.log('  npx canon-signal report-issue "How do I sample by user?" --type question')
}

switch (command) {
  case 'create': {
    loadCli('../dist/cli/create.js', '../dist/cli/create.cjs')
      .then(({ runCreate }) => runCreate(process.cwd()))
      .catch((err) => {
        console.error(err)
        process.exit(1)
      })
    break
  }

  case 'install-docs': {
    const flags = parseFlags(args.slice(1))
    loadCli('../dist/cli/install-docs.js', '../dist/cli/install-docs.cjs')
      .then(({ runInstallDocs }) =>
        runInstallDocs({
          cwd: process.cwd(),
          force: flags.force === true,
          writeAgentsMd: flags['no-agents-md'] !== true,
        }),
      )
      .catch((err) => {
        console.error(err)
        process.exit(1)
      })
    break
  }

  case 'tutorial': {
    const flags = parseFlags(args.slice(1))
    loadCli('../dist/cli/tutorial.js', '../dist/cli/tutorial.cjs')
      .then(({ runTutorial }) =>
        runTutorial({
          cwd: process.cwd(),
          copy: flags.copy === true,
          outPath: typeof flags.out === 'string' ? flags.out : undefined,
        }),
      )
      .catch((err) => {
        console.error(err)
        process.exit(1)
      })
    break
  }

  case 'report-issue': {
    // The first non-flag argument is treated as the title
    const subArgs = args.slice(1)
    const flags = parseFlags(subArgs)
    const title = subArgs.find((a) => !a.startsWith('--'))
    const type = ['bug', 'feature', 'question'].includes(flags.type) ? flags.type : 'bug'

    loadCli('../dist/cli/report-issue.js', '../dist/cli/report-issue.cjs')
      .then(({ runReportIssue }) =>
        runReportIssue({
          title,
          type,
          printOnly: flags['print-only'] === true,
        }),
      )
      .catch((err) => {
        console.error(err)
        process.exit(1)
      })
    break
  }

  case 'inspect': {
    loadCli('../dist/inspect/cli.js', '../dist/inspect/cli.cjs')
      .then(({ runInspect }) => runInspect(args.slice(1)))
      .catch((err) => {
        console.error(err)
        process.exit(1)
      })
    break
  }

  case '--help':
  case '-h':
  case 'help':
  case undefined:
    printHelp()
    break

  default:
    console.error(`canon-signal: unknown command "${command}"`)
    console.error()
    printHelp()
    process.exit(1)
}

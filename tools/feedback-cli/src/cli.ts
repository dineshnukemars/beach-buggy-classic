import { defaultFeedbackDir, latestReport, listReports, showReport, studioRoot, summarize } from './reports.ts'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return undefined
}

function flag(name: string): boolean {
  return process.argv.includes(name)
}

const command = process.argv[2]
const jsonOut = flag('--json')
const dir = arg('--dir') ?? defaultFeedbackDir(studioRoot())

try {
  if (command === 'list') {
    const rows = listReports(dir)
    if (jsonOut) console.log(JSON.stringify(rows.map((r) => r.report), null, 2))
    else rows.forEach((row) => console.log(summarize(row)))
  } else if (command === 'show') {
    const id = arg('--id')
    if (!id) throw new Error('Usage: feedback-cli show --id <id> [--json] [--dir <path>]')
    const row = showReport(dir, id)
    if (jsonOut) console.log(JSON.stringify(row.report, null, 2))
    else console.log(summarize(row))
  } else if (command === 'latest') {
    const row = latestReport(dir)
    if (jsonOut) console.log(JSON.stringify(row.report, null, 2))
    else console.log(summarize(row))
  } else {
    console.error('Usage: feedback-cli <list|show|latest> [--json] [--id <id>] [--dir <path>]')
    process.exit(1)
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
}

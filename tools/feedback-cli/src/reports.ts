import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parseFeedbackReport, type FeedbackReport } from '@studio/core'

export type ReportRecord = {
  id: string
  dir: string
  report: FeedbackReport
  createdAt: string
}

export function studioRoot(from = process.cwd()): string {
  let dir = resolve(from)
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json')
    if (existsSync(pkg)) {
      const json = JSON.parse(readFileSync(pkg, 'utf8')) as { workspaces?: string[] }
      if (json.workspaces) return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return resolve(from)
}

export function defaultFeedbackDir(root = studioRoot()): string {
  return join(root, 'games', 'beach-buggy', 'feedback')
}

export function listReports(dir: string): ReportRecord[] {
  if (!existsSync(dir)) return []
  const rows: ReportRecord[] = []
  for (const name of readdirSync(dir)) {
    const reportPath = join(dir, name, 'report.json')
    if (!existsSync(reportPath) || !statSync(reportPath).isFile()) continue
    const report = parseFeedbackReport(JSON.parse(readFileSync(reportPath, 'utf8')))
    rows.push({ id: report.id, dir: join(dir, name), report, createdAt: report.createdAt })
  }
  return rows.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
}

export function showReport(dir: string, id: string): ReportRecord {
  const match = listReports(dir).find((row) => row.id === id)
  if (!match) throw new Error(`report not found: ${id}`)
  return match
}

export function latestReport(dir: string): ReportRecord {
  const rows = listReports(dir)
  if (!rows[0]) throw new Error(`no feedback reports in ${dir}`)
  return rows[0]
}

export function summarize(row: ReportRecord): string {
  const { report } = row
  return [
    report.id,
    report.issue.tags.join(','),
    report.target.kind,
    report.target.id,
    report.agentHints.likelyLayer,
    report.agentHints.files.join(' '),
  ].join('\t')
}

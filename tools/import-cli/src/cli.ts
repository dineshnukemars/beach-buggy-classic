import { importFile } from './importFile.ts'

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name)
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1]
  return fallback
}

function flag(name: string): boolean {
  return process.argv.includes(name)
}

const file = arg('--file')
const game = arg('--game', 'beach-buggy')
const id = arg('--id')
if (!file || !id) {
  console.error('Usage: studio-import --file <path> --id <assetId> [--game beach-buggy] [--ci] [--kind gltf|texture|audio]')
  process.exit(1)
}

const kind = arg('--kind') as 'gltf' | 'texture' | 'audio' | undefined
const result = importFile({
  file,
  game: game!,
  id,
  kind,
  ci: flag('--ci'),
})
console.log(`imported ${result.dest}`)
console.log(`manifest ${result.manifestPath}`)

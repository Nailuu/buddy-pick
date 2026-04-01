import { runInteractiveFlow } from './ui.js'

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  buddy-pick — Pick your Claude Code /buddy companion

  Usage:
    npx buddy-pick          Interactive companion picker
    npx buddy-pick --help   Show this help
    npx buddy-pick --version

  Customize your Claude Code companion by previewing and
  patching the generation salt in the Claude binary.
`)
  process.exit(0)
}

if (args.includes('--version') || args.includes('-v')) {
  console.log('0.1.0')
  process.exit(0)
}

runInteractiveFlow().catch((err) => {
  if (err instanceof Error && err.message.includes('User force closed')) {
    process.exit(0)
  }
  console.error(err)
  process.exit(1)
})

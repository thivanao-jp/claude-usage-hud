const { execSync } = require('child_process')
const fs = require('fs')

module.exports = async function afterSign(context) {
  const { electronPlatformName, appOutDir } = context
  if (electronPlatformName !== 'darwin') return

  // APIキー方式（推奨）
  const apiKey = process.env.APPLE_API_KEY
  const apiKeyId = process.env.APPLE_API_KEY_ID
  const apiIssuer = process.env.APPLE_API_ISSUER

  // Apple ID方式（フォールバック）
  const appleId = process.env.APPLE_ID
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD
  const teamId = process.env.APPLE_TEAM_ID

  const hasApiKey = apiKey && apiKeyId && apiIssuer
  const hasAppleId = appleId && appleIdPassword && teamId

  if (!hasApiKey && !hasAppleId) {
    console.log('notarize: skipped (no credentials set)')
    return
  }

  const appName = context.packager.appInfo.productFilename
  const appPath = `${appOutDir}/${appName}.app`
  const zipPath = `/tmp/${appName}-notarize.zip`

  console.log(`notarize: zipping ${appPath}`)
  execSync(`ditto -c -k --sequesterRsrc --keepParent "${appPath}" "${zipPath}"`)

  const auth = hasApiKey
    ? `--key "${apiKey}" --key-id "${apiKeyId}" --issuer "${apiIssuer}"`
    : `--apple-id "${appleId}" --password "${appleIdPassword}" --team-id "${teamId}"`

  console.log(`notarize: submitting (${hasApiKey ? 'API Key' : 'Apple ID'})...`)
  const submitOut = execSync(
    `xcrun notarytool submit "${zipPath}" ${auth} --output-format json --no-wait`
  ).toString()
  const submitted = JSON.parse(submitOut)
  const submissionId = submitted.id
  console.log(`notarize: submitted. id=${submissionId}`)

  const MAX_MINUTES = 40
  for (let i = 1; i <= MAX_MINUTES; i++) {
    await new Promise(r => setTimeout(r, 60 * 1000))
    const infoOut = execSync(
      `xcrun notarytool info "${submissionId}" ${auth} --output-format json`
    ).toString()
    const info = JSON.parse(infoOut)
    console.log(`notarize: [${i}/${MAX_MINUTES}min] status=${info.status}`)

    if (info.status === 'Accepted') {
      console.log('notarize: accepted! stapling...')
      try {
        execSync(`xcrun stapler staple "${appPath}"`)
        console.log('notarize: stapled.')
      } catch (e) {
        console.warn('notarize: staple failed (non-fatal):', e.message)
      }
      try { fs.unlinkSync(zipPath) } catch {}
      return
    }

    if (info.status === 'Invalid' || info.status === 'Rejected') {
      try {
        const logOut = execSync(`xcrun notarytool log "${submissionId}" ${auth}`).toString()
        console.error('notarize: Apple rejection log:\n', logOut)
      } catch {}
      try { fs.unlinkSync(zipPath) } catch {}
      throw new Error(`Notarization ${info.status}: submissionId=${submissionId}`)
    }
  }

  try { fs.unlinkSync(zipPath) } catch {}
  throw new Error(`Notarization timed out after ${MAX_MINUTES} minutes. id=${submissionId}`)
}

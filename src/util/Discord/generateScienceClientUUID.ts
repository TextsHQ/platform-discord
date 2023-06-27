// https://docs.google.com/document/d/1b5aDx7S1iLHoeb6B56izZakbXItA84gUjFzK-0OBwy0
let scienceIncrement = 0n

export const generateScienceClientUUID = (userIDStr?: string): string | undefined => {
  if (!userIDStr) return

  const randomPrefix = 0 | Math.floor(4294967296 * Math.random())
  const creationTime = BigInt(Date.now())
  const userID = BigInt(userIDStr)

  const r = Buffer.allocUnsafe(24)

  r.writeInt32LE(Number(userID % 4294967296n), 0)

  r.writeInt32LE(Number(userID >> 32n), 4)
  r.writeInt32LE(randomPrefix, 8)

  r.writeInt32LE(Number(creationTime % 4294967296n), 12)

  r.writeInt32LE(Number(creationTime >> 32n), 16)
  r.writeInt32LE(Number(scienceIncrement++), 20)

  return r.toString('base64')
}

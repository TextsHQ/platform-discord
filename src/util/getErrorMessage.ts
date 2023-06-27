export const getErrorMessage = (res: { statusCode: number, json?: any }): string => (res ? (res.json?.message || `Invalid response: ${res.statusCode}`) : 'No response')

export default getErrorMessage

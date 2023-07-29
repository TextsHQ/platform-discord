export const getErrorMessage = (res: { statusCode: number, json?: any }): string => (`${res.json?.message ?? 'Invalid response'} (${res.statusCode})`)

export * from './Discord'

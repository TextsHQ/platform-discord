import { CurrentUser } from '@textshq/platform-sdk'

const got = require('got')

function handleErrors(json: JSON) {
  console.error(json)
}

export default class TwitterAPI {
  private token?: string

  // MARK: - Public functions
  public setToken = (token?: string) => {
    this.token = token
  }

  public getCurrentUser = async (): Promise<CurrentUser> => {
    const userJson = await this.fetch({ method: 'GET', url: 'https://discord.com/api/v8/users/@me' })
    if (!userJson) throw new Error('No response')

    return {
      displayText: `${userJson.username}#${userJson.discriminator}`,
      id: userJson.id,
      fullName: userJson.username,
      username: `${userJson.username}#${userJson.discriminator}`,
      phoneNumber: userJson.phone,
      email: userJson.email,
      nickname: userJson.username,
      imgURL: `https://cdn.discordapp.com/avatars/${userJson.id}/${userJson.avatar}.png?size=256`,
      isVerified: userJson.verified,
      cannotMessage: true,
      isSelf: true,
    }
  }

  // - MARK: Private functions
  private fetch = async ({ headers = {}, ...rest }) => {
    if (!this.token) throw new Error('Discord token hasn\'t been found.')

    try {
      const res = await got({
        throwHttpErrors: false,
        headers: {
          Authorization: this.token,
          ...headers,
        },
        ...rest,
      })

      if (!res.body) return

      const json = JSON.parse(res.body)
      handleErrors(json)
      return json
    } catch (err) {
      if (err.code === 'ECONNREFUSED' && (err.message.endsWith('0.0.0.0:443') || err.message.endsWith('127.0.0.1:443'))) {
        console.log('Discord is blocked')
        throw Error('Discord seems to be blocked on your device. This could have been done by an app or a manual entry in /etc/hosts')
      }
      throw err
    }
  }
}

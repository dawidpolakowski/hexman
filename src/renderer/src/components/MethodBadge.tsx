// SPDX-License-Identifier: Apache-2.0
import type { ApiRequest } from '../model'

function MethodBadge({
  request
}: {
  request: Pick<ApiRequest, 'kind' | 'method'>
}): React.JSX.Element {
  const gql = request.kind === 'graphql'
  return (
    <span className={`method method-${gql ? 'gql' : request.method.toLowerCase()}`}>
      {gql ? 'GQL' : request.method}
    </span>
  )
}

export default MethodBadge

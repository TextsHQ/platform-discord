import type { TextEntity } from '@textshq/platform-sdk';
import type { SingleASTNode } from 'simple-markdown';

function makeEntity(node: SingleASTNode): TextEntity {
  console.log(node)
  return { from: 0, to: 0 }
}

export default function makeEntities(nodes: SingleASTNode[]): TextEntity[] {
  return nodes.map(makeEntity)
}

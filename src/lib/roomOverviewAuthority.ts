export function createOverviewLoadGuard() {
 let generation=0;
 return {
  start(scope:string) { return {generation:++generation,scope}; },
  isCurrent(token:{generation:number;scope:string},scope:string) {
   return token.generation===generation && token.scope===scope;
  },
  invalidate() { generation++; },
 };
}

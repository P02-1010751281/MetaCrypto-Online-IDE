/**
 * 项目级符号表（多文件 Blockly 的扁平命名空间）。
 *
 * 第一阶段不做模块 import：所有 block 文件生成到同一个命名空间，函数名必须唯一。
 * 编辑器用它把其他文件的函数列进 call 下拉；生成器只输出普通函数调用。
 */

export interface ProjectFunctionParam {
  name: string
  type: string
}

export interface ProjectFunctionSymbol {
  fileId: string
  path: string
  name: string
  params: ProjectFunctionParam[]
  hasReturn: boolean
}

let symbols: ProjectFunctionSymbol[] = [];

export function setProjectSymbols(next: ProjectFunctionSymbol[]): void {
  symbols = Array.isArray(next) ? next.slice() : [];
}

export function getProjectSymbols(): ProjectFunctionSymbol[] {
  return symbols;
}

export function findProjectSymbol(name: string): ProjectFunctionSymbol | undefined {
  return symbols.find((symbol) => symbol.name === name);
}

export function projectSymbolLabel(symbol: ProjectFunctionSymbol): string {
  return `${symbol.path}::${symbol.name}`;
}

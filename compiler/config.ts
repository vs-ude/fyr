"use strict"

export class FyrConfiguration {
	public emitC: boolean = false;
	public emitNative: boolean = false;
	public emitWasm: boolean = false;
	public emitIr: boolean = false;
	public disableCodegen: boolean = true;
	public disableRuntime: boolean = false;
	public disableNullCheck: boolean = false;
	public emitErrors: boolean = false;
	public fyrPaths: string[];
	public sourcePath: Array<string | object>;
}
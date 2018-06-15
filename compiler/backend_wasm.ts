import * as wasm from "./wasm"
import {SystemCalls, Package} from "./pkg"
import {SMTransformer, Optimizer, Stackifier, Type, PointerType, StructType, FunctionType, Variable, sizeOf, Node, alignmentOf, isSigned, NodeKind, BinaryData} from "./ssa"
import * as backend from "./backend"
import {BinaryBuffer} from "./binarybuffer"

export type Wasm32StorageType = "local" | "vars" | "params" | "result" | "local_result" | "local_var" | "global" | "global_heap" | "global_strings";

export class Wasm32Storage {
    public storageType: Wasm32StorageType;
    public offset: number;
}

class Wasm32LocalVariableList {
    constructor(localsUsed: number) {
        this.localsUsed = localsUsed;
    }

    public clone(): Wasm32LocalVariableList {
        let l = new Wasm32LocalVariableList(this.localsUsed);
        for(let v of this.used) {
            l.used.push(v);
        }
        l.locals = this.locals;
        return l;
    }

    public allocate(type: Type | PointerType): number {
        let t: wasm.StackType;
        switch(type) {
            case "i64":
            case "s64":
                t = "i64";
                break;
            case "f64":
                t = "f64";
                break;
            case "f32":
                t = "f32";
                break;
            default:
                t = "i32";
                break;
        }
        for(let i = 0; i < this.locals.length; i++) {
            if (this.locals[i] == type && !this.used[i]) {
                this.used[i] = true;
                return this.localsUsed + i;
            }
        }
        this.locals.push(t);
        this.used.push(true);
        return this.localsUsed + this.locals.length - 1;
    }

    public locals: Array<wasm.StackType> = [];
    public used: Array<boolean> = [];
    private localsUsed: number;
}

export class Wasm32Backend implements backend.Backend {
    constructor() {
        this.tr = new SMTransformer();
        this.optimizer = new Optimizer();
        this.stackifier = new Stackifier(this.optimizer);
        this.funcs = [];
        this.globalVarStorage = new Map<Variable, Wasm32Storage>();
        this.globalVariables = [];
        this.module = new wasm.Module();
        this.module.importMemory("imports", "mem");
        this.module.funcTypes.push(new wasm.FunctionType("$callbackFn", ["i32", "i32"], ["i32"]));
        this.heapGlobalVariableIndex = 0;
        this.heapGlobalVariable = new wasm.Global("i32", null, false);
        this.module.addGlobal(this.heapGlobalVariable);
        this.typemapGlobalVariableIndex = 1;
        this.typemapGlobalVariable = new wasm.Global("i32", null, false);
        this.module.addGlobal(this.typemapGlobalVariable);
        this.customglobalVariablesIndex = 2;
        this.varsFrameHeader = new StructType();
        this.varsFrameHeader.addField("$func", "i32");
        this.varsFrameHeader.addField("$sp", "i32");
        this.varsFrameHeader.addField("$step", "i32");
        this.varsFrameHeader.addField("$prevFrame", "addr");
    }

    public getCode(): string {
        return this.module.toWast("");
    }

    public addFunctionToTable(f: backend.Function, index: number) {
        if (!(f instanceof wasm.Function)) {
            throw "Implementation error";
        }
        return this.module.addFunctionToTable(f, index);
    }

    public importFunction(name: string, from: string | Package, type: FunctionType): backend.FunctionImport {
        if (typeof(from) != "string") {
            throw "TODO: Packet import in WASM";
        }
        let wt = new wasm.FunctionType(name, [], []);
        for(let p of type.params) {
            if (!(p instanceof StructType)) {
                wt.params.push(this.stackTypeOf(p))
            }
        }
        if (type.result) {
            if (!(type.result instanceof StructType)) {
                wt.results.push(this.stackTypeOf(type.result));
            }
        }
        wt.params.push("i32");
        let f = new wasm.FunctionImport(name, from, wt);
        this.module.addFunctionImport(f);
        return f;
    }

    public declareGlobalVar(name: string, type: Type | StructType): Variable {
        let v = new Variable(name);
        v.type = type;
        v.readCount = 2; // Avoid that global variables are optimized away
        v.writeCount = 2;
        this.globalVariables.push(v);
        return v;
    }

    public declareFunction(name: string): backend.Function {
        let wf = new wasm.Function(name);
        this.module.addFunction(wf);        
        return wf;
    }

    public declareInitFunction(name: string): backend.Function {
        let wf = new wasm.Function(name);
        this.module.setInitFunction(wf);
        return wf;
    }

    public getInitFunction(): backend.Function {
        return this.module.initFunction;
    }

    public defineFunction(n: Node, f: wasm.Function, isExported: boolean, isPossibleDuplicate: boolean) {
        this.funcs.push({node: n, wf: f, isExported: isExported});
    }

    public generateModule(emitIR: boolean, initPackages: Array<Package> | null, duplicateCodePackages: Array<Package> | null): string {
        let ircode = "";

        // Generate WASM code for all globals
        let index = this.customglobalVariablesIndex;
        for(let v of this.globalVariables) {
            if (v.isConstant && typeof(v.constantValue) == "string") {
                let [offset, len] = this.module.addString(v.constantValue);
                let s: Wasm32Storage = {storageType: "global_strings", offset: offset};
                this.globalVarStorage.set(v, s);                    
            } else if (v.isConstant && v.constantValue instanceof Array) {
                let data = this.encodeLiteral(v.type, v.constantValue as BinaryData);
                let offset = this.module.addBinary(data)
                let s: Wasm32Storage = {storageType: "global_heap", offset: offset};
                this.globalVarStorage.set(v, s);
            } else if (v.addressable || v.type instanceof StructType || v.type == "ptr") {
                let offset = this.module.addGlobalStruct(sizeOf(v.type));
                let s: Wasm32Storage = {storageType: "global_heap", offset: offset};
                this.globalVarStorage.set(v, s);
            } else {
                let s: Wasm32Storage = {storageType: "global", offset: index};
                this.globalVarStorage.set(v, s);
                let g = new wasm.Global(this.stackTypeOf(v.type), "$" + v.name, true);
                this.module.addGlobal(g);
                index++;
            }
        }

        // Generate WASM code for all functions
        for(let f of this.funcs) {
            this.optimizer.optimizeConstants(f.node);
            if (emitIR) {
                ircode += '============ OPTIMIZED Constants ===============\n';
                ircode += Node.strainToString("", f.node) + "\n";
            }

            this.optimizer.removeDeadCode(f.node);
            if (emitIR) {
                ircode += '============ OPTIMIZED Dead code ===============\n';
                ircode += Node.strainToString("", f.node) + "\n";
            }

            ircode += this.generateFunction(f.node, f.wf, emitIR);
            if (f.isExported) {
                let wfExport = new wasm.Function();
                wfExport.isExported = true;
                wfExport.parameters = f.wf.parameters.slice(0, f.wf.parameters.length - 1); // Strip the sp parameter
                wfExport.results = f.wf.results;
                let code: Array<wasm.Node> = [];
                let i = 0;
                if (wfExport.parameters && wfExport.parameters.length != 0) {
                    for(let t of wfExport.parameters) {
                        code.push(new wasm.GetLocal(i));
                        i++;
                    }
                }
                code.push(new wasm.Constant("i32", 0));
                code.push(new wasm.Call("$startHostCoroutine"));
                code.push(new wasm.Call(f.wf.index));
                code.push(new wasm.Constant("i32", 0));
                code.push(new wasm.Call("$finishHostCoroutine"));
                if (wfExport.results && wfExport.results.length != 0) {
                    if (wfExport.results.length != 1) {
                        throw "Implementation error in export";
                    }
                    code.push(new wasm.Return());
                }
                wfExport.statements = code;
                this.module.addFunction(wfExport);
                this.module.exports.set(f.wf.name, wfExport);                
            }
        }

        this.module.memorySize = this.module.textSize() + this.heapSize + this.stackSize;

        this.heapGlobalVariable.initial = [new wasm.Constant("i32", this.module.textSize())];

        return ircode;
    }

    private generateFunction(n: Node, f: wasm.Function, emitIR: boolean): string {
        if (n.kind != "define" || (!(n.type instanceof FunctionType))) {
            throw "Implementation error";
        }
        this.steps = [];
        this.stepCode = [];
        this.stepsByName = new Map<string, number>();
        this.asyncCalls = [];
        this.asyncCallCode = [];
        this.resultFrame = new StructType();
        this.paramsFrame = new StructType();
        this.varsFrame = new StructType();
        this.varStorage = new Map<Variable, Wasm32Storage>();
        this.varGCStorage = new Map<Variable, Wasm32Storage>();
        this.varAsyncStorage = new Map<Variable, Wasm32Storage>();
        this.varBinaryConstants = new Map<Variable, number>();
        this.tmpLocalVariables = new Map<number, [boolean, wasm.StackType]>();
        this.parameterVariables = [];
        this.returnVariables = [];
        this.localVariables = [];
        this.tmpI32Local = -1;
        this.tmpI64Local = -1;
        this.tmpF32Local = -1;
        this.tmpF64Local = -1;
        this.tmpI32SrcLocal = -1;
        this.tmpI32DestLocal = -1;
        this.wf = f;

        if (n.type.callingConvention == "fyrCoroutine") {
            return this.generateAsyncFunction(n, f, emitIR);
        }
        return this.generateSyncFunction(n, f, emitIR);
    }

    private generateSyncFunction(n: Node, wf: wasm.Function, emitIR): string {
        let ircode = "";

        if (n.kind != "define" || (!(n.type instanceof FunctionType))) {
            throw "Implementation error";
        }

        this.wfIsAsync = false;

        this.traverse(n.next[0], n.blockPartner, null);
        this.stackifier.stackifyStep(n, null);
        let locals = new Wasm32LocalVariableList(0);
        this.analyzeVariableStorage(n, n.blockPartner, locals);

        let code: Array<wasm.Node> = [];
        
        // Is this the module initialization function? Then initialize stack and memory first
        if (wf.isInitFunction) {
            this.spLocal = this.wf.parameters.length;
            this.wf.locals.push("i32"); // sp
            // Start with the stack at the very end of the memory
            code.push(new wasm.CurrentMemory());
            code.push(new wasm.Constant("i32", 16));
            code.push(new wasm.BinaryInstruction("i32", "shl"));
            code.push(new wasm.TeeLocal(this.spLocal));
            // Initialize the memory
            code.push(new wasm.Call("$initializeMemory"));
            // Set the final stack pointer
            code.push(new wasm.SetLocal(this.spLocal));
        } else {
            this.spLocal = this.wf.parameters.length;
            this.wf.parameters.push("i32"); // sp
        }

        if (this.varsFrame.size > 0 || this.paramsFrame.size > 0 || this.resultFrame.size > 0) {
            this.bpLocal = this.wf.parameters.length;
            this.wf.locals.push("i32"); // bp
        } else {
            this.bpLocal = -1;
        }

        // Shift the index of local variables, since other WASM parameters and locals (sp, bp) have been inserted.
        for(let v of this.varStorage.keys()) {
            let s = this.varStorage.get(v);
            if (s.storageType == "local_var") {
                s.offset += this.wf.parameters.length + this.wf.locals.length;
                s.storageType = "local";
            }
        }
        // Add the local variables to WASM
        this.wf.locals = this.wf.locals.concat(locals.locals);

        if (emitIR) {
            ircode += '============ STACKIFIED code ===============\n';
            ircode += Node.strainToString("", n) + "\n";
            for(let v of this.varStorage.keys()) {
                let s = this.varStorage.get(v);
                ircode += v.name + " -> " + s.storageType.toString() + " " +  s.offset.toString() + "\n";
            }
            ircode += "sp -> local " + this.spLocal.toString() + "\n";
            ircode += "bp -> local " + this.bpLocal.toString() + "\n";
        }

/*        if (this.emitIR || this.emitIRFunction == wf.name) {
            console.log("========= Stackified ==========");
            console.log(Node.strainToString("", n));
            for(let v of this.varStorage.keys()) {
                let s = this.varStorage.get(v);
                console.log(v.name + " -> ", s.storageType, s.offset);
            }
            console.log("sp -> local " + this.spLocal);
            console.log("bp -> local " + this.bpLocal);
        }
*/

        // Generate function body
        if (this.varsFrame.size > 0) {
            // Put the varsFrame on the heap_stack and set BP
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.Constant("i32", this.varsFrame.size));
            code.push(new wasm.BinaryInstruction("i32", "sub"));
            code.push(new wasm.TeeLocal(this.spLocal));
            code.push(new wasm.TeeLocal(this.bpLocal)); // Now SP and BP point to the varsFrame
        } else if (this.resultFrame.size != 0 || this.paramsFrame.size != 0) {
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.SetLocal(this.bpLocal)); // Now SP and BP point to the varsFrame
        }

        // Save variables which are parameters stored in WASM local variables but need to be GC discoverable.
        for(var v of this.parameterVariables) {
            if (!this.varGCStorage.has(v)) {
                continue;
            }            
            let s = this.varStorage.get(v);
            let sAlternative = this.varGCStorage.get(v);
            let t = this.stackTypeOf(v.type as Type);
            let asType: null | "8"| "16" | "32" = null;
            switch (v.type) {
                case "i8":
                case "s8":
                    asType = "8";
                    break;
                case "i16":
                case "s16":
                    asType = "16";
                    break;
            }
            code.push(new wasm.GetLocal(this.bpLocal));
            code.push(new wasm.GetLocal(s.offset));
            code.push(new wasm.Store(t, asType, sAlternative.offset));            
        }
        
        this.emitCode(0, n.next[0], null, code, 0, 0);

        this.wf.statements = code;

        return ircode;
    }

    private generateAsyncFunction(n: Node, wf: wasm.Function, emitIR: boolean): string {
        let ircode = "";

        if (n.kind != "define" || (!(n.type instanceof FunctionType))) {
            throw "Implementation error";
        }

        this.wfIsAsync = true;

        this.tr.transform(n);
        if (emitIR) {
            ircode += "========= State Machine ==========\n";
            ircode += Node.strainToString("", n) + "\n";
        }

        // Make room to store function index, sp and step upon async calls.
        this.varsFrame.addFields(this.varsFrameHeader);

        // The step is always the first parameter of an async function
        this.stepLocal = this.wf.parameters.length;
        this.wf.parameters.push("i32"); // step

        this.traverse(n.next[0], n.blockPartner, null);

        for(let i = 0; i < this.steps.length; i++) {
            let n = this.steps[i];
            this.stackifier.stackifyStep(n, null);
        }

        let locals = new Wasm32LocalVariableList(0);
        let typemap = this.analyzeVariableStorage(n, n.blockPartner, locals);
                
        this.spLocal = this.wf.parameters.length;
        this.wf.parameters.push("i32"); // sp

        this.wf.results.push("i32"); // interrupt or complete

        this.bpLocal = this.wf.parameters.length;
        this.wf.locals.push("i32"); // bp
        this.asyncReturnLocal = this.wf.parameters.length + wf.locals.length;
        this.wf.locals.push("i32"); // asyncReturn

        // Shift the index of local variables, since other WASM parameters and locals (sp, bp) have been inserted.
        for(let v of this.varStorage.keys()) {
            let s = this.varStorage.get(v);
            if (s.storageType == "local_var") {
                s.offset += this.wf.parameters.length + this.wf.locals.length;
                s.storageType = "local";
            }
        }
        this.wf.locals = this.wf.locals.concat(locals.locals);

        if (emitIR) {
            ircode += '============ STACKIFIED code ===============\n';
            ircode += Node.strainToString("", n) + "\n";
            for(let v of this.varStorage.keys()) {
                let s = this.varStorage.get(v);
                ircode += v.name + " -> " + s.storageType.toString() + " " +  s.offset.toString() + "\n";
            }
            ircode += "sp -> local " + this.spLocal.toString() + "\n";
            ircode += "bp -> local " + this.bpLocal.toString() + "\n";
            ircode += "step -> local " + this.stepLocal + "\n";
            ircode += "varsFrame = " + this.varsFrame.toDetailedString() + "\n";
        }

/*        if (this.emitIR || this.emitIRFunction == wf.name) {
            console.log("========= Stackified ==========");
            console.log(Node.strainToString("", n));
            for(let v of this.varStorage.keys()) {
                let s = this.varStorage.get(v);
                console.log(v.name + " -> ", s.storageType, s.offset);
            }
            console.log("sp -> local " + this.spLocal);
            console.log("bp -> local " + this.bpLocal);
            console.log("step -> local " + this.stepLocal);
            console.log("varsFrame = ", this.varsFrame.toDetailedString());
        } */

        // Generate function body
        let code: Array<wasm.Node> = [];

        // If the function is invoked with step 0xfffffffe or 0xffffffff, build up the stack
        code.push(new wasm.GetLocal(this.stepLocal));
        code.push(new wasm.Constant("i32", 0xfffffffe));
        code.push(new wasm.BinaryInstruction("i32", "ge_u"));
        code.push(new wasm.If());
        // Put the varsFrame on the heap_stack and set BP
        code.push(new wasm.GetLocal(this.spLocal));
        code.push(new wasm.Constant("i32", this.varsFrame.size));
        code.push(new wasm.BinaryInstruction("i32", "sub"));
        code.push(new wasm.TeeLocal(this.spLocal));
        code.push(new wasm.TeeLocal(this.bpLocal)); // Now SP and BP point to the localsFrame
        // So far no parent function has yielded
        code.push(new wasm.GetLocal(this.bpLocal));
        code.push(new wasm.Constant("i32", 0));
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$prevFrame")));
        // If step is 0xffffffff, set the step to 0
        code.push(new wasm.GetLocal(this.stepLocal));
        code.push(new wasm.Constant("i32", 0xffffffff));
        code.push(new wasm.BinaryInstruction("i32", "eq"));
        code.push(new wasm.If());
        code.push(new wasm.Constant("i32", 0));
        code.push(new wasm.SetLocal(this.stepLocal))
        code.push(new wasm.End());        
        code.push(new wasm.Else());        
        // If this is not the first step, load all local variables from the heap        
        code.push(new wasm.GetLocal(this.spLocal));
        code.push(new wasm.TeeLocal(this.bpLocal));
        code.push(new wasm.Load("i32", null, this.varsFrame.fieldOffset("$sp")));
        code.push(new wasm.SetLocal(this.spLocal));
        
        for(var v of this.localVariables) {
            if (!this.varAsyncStorage.has(v)) {
                continue;
            }            
            let s = this.varStorage.get(v);
            let sAlternative = this.varAsyncStorage.get(v);
            let t = this.stackTypeOf(v.type as Type);
            let asType: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u" = null;
            switch (v.type) {
                case "i8":
                    asType = "8_u";
                    break;
                case "s8":
                    asType = "8_s";
                    break;
                case "i16":
                    asType = "16_u";
                    break;
                case "s16":
                    asType = "16_s";
                    break;
            }        
            code.push(new wasm.GetLocal(this.bpLocal));
            code.push(new wasm.Load(t, asType, sAlternative.offset));
            code.push(new wasm.SetLocal(s.offset));
        }
        code.push(new wasm.End());
        
        // TODO: What is this good for?
        //code.push(new wasm.GetLocal(this.spLocal));
        //code.push(new wasm.Constant("i32", 0));
        //code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$sp")));

        // Main loop of the function
        code.push(new wasm.Block());
        code.push(new wasm.Loop());
        this.emitSteps();
        let targets: Array<number> = [];
        for(let i = 0; i < this.stepCode.length; i++) {
            code.push(new wasm.Block());
            targets.push(i);
        }
        for(let i = 0; i < this.asyncCallCode.length; i++) {
            code.push(new wasm.Block());
        }
        targets.push(this.stepCode.length + this.asyncCallCode.length + 1); // The default branch target: Exit
        code.push(new wasm.GetLocal(this.stepLocal));
        // Branch to the target steps
        code.push(new wasm.BrTable(targets));
        for(let c of this.stepCode) {
            code = code.concat(c);
        }
        for(let c of this.asyncCallCode) {
            code = code.concat(c);
        }
        // End of the main loop
        code.push(new wasm.End());
        code.push(new wasm.End());

        // The following code is the async exit from a function.
        // If step is 0xffffffff, set the step to 0
        code.push(new wasm.GetLocal(this.stepLocal));
        code.push(new wasm.Constant("i32", 0xfffffffe));
        code.push(new wasm.BinaryInstruction("i32", "eq"));
        code.push(new wasm.If());
        code.push(new wasm.Constant("i32", 0));
        code.push(new wasm.SetLocal(this.stepLocal));
        code.push(new wasm.End());                
        // Store the current state in the stack frame
        code.push(new wasm.GetLocal(this.bpLocal));
        code.push(new wasm.GetLocal(this.stepLocal));
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$step")));
        code.push(new wasm.GetLocal(this.bpLocal));
        code.push(new wasm.GetLocal(this.spLocal));
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$sp")));
        code.push(new wasm.GetLocal(this.bpLocal));
        code.push(new wasm.Constant("i32", this.module.funcTable.length));
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$func")));
        // Save parameters stored in WASM local variables on the stack frame
        let needsCallbackFunction = false;
        for(var v of this.parameterVariables.concat(this.localVariables)) {
            let sAlternative: Wasm32Storage;
            if (this.varGCStorage.has(v)) {
                sAlternative = this.varGCStorage.get(v);
            } else if (this.varAsyncStorage.has(v)) {
                sAlternative = this.varAsyncStorage.get(v);
            } else {
                continue;
            }            
            let s = this.varStorage.get(v);
            if (this.parameterVariables.indexOf(v) != -1) {
                needsCallbackFunction = true;
            }
            let t = this.stackTypeOf(v.type as Type);
            let asType: null | "8"| "16" | "32" = null;
            switch (v.type) {
                case "i8":
                case "s8":
                    asType = "8";
                    break;
                case "i16":
                case "s16":
                    asType = "16";
                    break;
            }
            code.push(new wasm.GetLocal(this.bpLocal));
            code.push(new wasm.GetLocal(s.offset));            
            code.push(new wasm.Store(t, asType, sAlternative.offset));
        }
        // Return a pointer to the top-most stack frame
        // By default, return the BP, if the function did not complete.
        // If asyncReturnLocal is not null (i.e. a nested function did not complete), return the asyncReturnLocal.
        code.push(new wasm.GetLocal(this.asyncReturnLocal));
        code.push(new wasm.If());
        code.push(new wasm.GetLocal(this.asyncReturnLocal));
        code.push(new wasm.GetLocal(this.bpLocal));        
        code.push(new wasm.Store("i32", null, this.varsFrame.fieldOffset("$prevFrame")));
        code.push(new wasm.GetLocal(this.asyncReturnLocal));
        code.push(new wasm.Return());
        code.push(new wasm.End());
        code.push(new wasm.GetLocal(this.bpLocal));
        code.push(new wasm.Return());

        this.wf.statements = code;

        if (needsCallbackFunction) {
            let callbackWf = new wasm.Function();
            this.module.addFunction(callbackWf);

            callbackWf.parameters.push("i32");
            callbackWf.parameters.push("i32");
            callbackWf.results.push("i32");
            let code: Array<wasm.Node> = [];
            code.push(new wasm.Comment("CallbackFn of " + this.wf.name));
            code.push(new wasm.GetLocal(0));
            for(var v of this.parameterVariables) {
                let sAlternative: Wasm32Storage;
                if (this.varGCStorage.has(v)) {
                    sAlternative = this.varGCStorage.get(v);
                } else if (this.varAsyncStorage.has(v)) {
                    sAlternative = this.varAsyncStorage.get(v);
                } else {
                    continue;
                }            
                let s = this.varStorage.get(v);
                let t = this.stackTypeOf(v.type as Type);
                let asType: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u" = null;
                switch (v.type) {
                    case "i8":
                        asType = "8_u";
                        break;
                    case "s8":
                        asType = "8_s";
                        break;
                    case "i16":
                        asType = "16_u";
                        break;
                    case "s16":
                        asType = "16_s";
                        break;
                }        
                code.push(new wasm.GetLocal(1));
                code.push(new wasm.Load(t, asType, sAlternative.offset));
            }
            code.push(new wasm.GetLocal(1));
            code.push(new wasm.Call(this.wf.index));
            code.push(new wasm.Return());
            callbackWf.statements = code;
            this.module.funcTable.push(callbackWf);
        } else {
            this.module.funcTable.push(this.wf);
        }

        return ircode
    }

    /**
     * Collects all steps and async calls
     * and remove all 'const' nodes which assign to variables that are SSA.
     */
    private traverse(start: Node, end: Node, step: Node) {
        let n = start;
        for( ; n; ) {
            // Analyze the arguments
            for(let v of n.args) {
                if (v instanceof Variable) {
                    if (v._step && v._step != step) {
                        v.usedInMultipleSteps = true;
                    } else {
                        v._step = step;
                    }                    
                }
            }
            // Analze the assignment
            if (n.assign) {
                if (n.assign._step && n.assign._step != step) {
                    n.assign.usedInMultipleSteps = true;
                } else {
                    n.assign._step = step;
                }
            }

            if (n == end) {
                break;
            } else if (n.kind == "step") {
                step = n;
                this.stepsByName.set(n.name, this.steps.length);
                this.steps.push(n);
                n = n.next[0];
            } else if (n.kind == "if") {
                if (n.next.length > 1) {
                    this.traverse(n.next[1], n.blockPartner, step);
                }
                n = n.next[0];
            } else if (n.kind == "call_begin" || n.kind == "yield") {
                this.asyncCalls.push(n);
                n = n.next[0];
            } else {
                n = n.next[0];
            }
        }
    }

    private analyzeVariableStorage(start: Node, end: Node, locals: Wasm32LocalVariableList) {
        let n = start;
        for(; n; ) {
            // Ignore decl_var here. These variables get storage when they are assigned.
            // Parameters and result variables, however, need storage even if they are not being assigned.
            if (n.kind == "decl_result" && (this.wfIsAsync || n.type instanceof StructType)) {
                // Structs are returned via the heap stack.
                // If async, everything is returned via the heap stack.
                let index = this.resultFrame.addField(n.assign.name, n.type as Type | StructType);
                let s: Wasm32Storage = {storageType: "result", offset: index};
                this.varStorage.set(n.assign, s);
                this.returnVariables.push(n.assign);
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_result") {
                let s: Wasm32Storage = {storageType: "local_result", offset: this.wf.results.length};
                this.wf.results.push(this.stackTypeOf(n.type as Type));
                this.varStorage.set(n.assign, s);
                this.returnVariables.push(n.assign);
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_param" && n.type instanceof StructType) {
                // Structs are always passed on the stack
                let index = this.paramsFrame.addField(n.assign.name, n.type as Type | StructType);
                let s: Wasm32Storage = {storageType: "params", offset: index};
                this.varStorage.set(n.assign, s);
                this.parameterVariables.push(n.assign);                
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_param") {
                let s: Wasm32Storage = {storageType: "local", offset: this.wf.parameters.length};
                let t = this.stackTypeOf(n.type as Type);
                this.wf.parameters.push(t);
                this.varStorage.set(n.assign, s);
                if (n.assign.gcDiscoverable) {
                    let index = this.varsFrame.addField("$param" + s.offset.toString(), t);
                    let sAlternative: Wasm32Storage = {storageType: "vars", offset: index};
                    this.varGCStorage.set(n.assign, sAlternative);
                } else if (this.wfIsAsync) {
                    // If the function yields, the heapstack must store the value of the parameter
                    let index = this.varsFrame.addField("$param" + s.offset.toString(), t);
                    let sAlternative: Wasm32Storage = {storageType: "vars", offset: index};
                    this.varAsyncStorage.set(n.assign, sAlternative);
                }
                this.parameterVariables.push(n.assign);                
                n = n.next[0];                
                continue;
            } else if (n.kind == "decl_var") {
                // Do nothing by intention. Variables are allocated when they are used
                n = n.next[0];                
                continue;
            }
            if (n.assign) {
                this.assignVariableStorage(n.assign, locals);
            }
            for(let v of n.args) {
                if (v instanceof Variable) {
                    this.assignVariableStorage(v, locals);
                } else if (v instanceof Node) {
                    this.analyzeVariableStorage(v, null, locals);
                }
            }
            if (n.kind == "if" && n.next.length > 1) {
                this.analyzeVariableStorage(n.next[1], n.blockPartner, locals.clone());
                n = n.next[0];
            } else {
                n = n.next[0];                
            }
        }
    }

    private assignVariableStorage(v: Variable, locals: Wasm32LocalVariableList): void {
        if (v.name == "$mem") {
            return;
        }
        if (this.varStorage.has(v) || this.globalVarStorage.has(v)) {
            return;
        }
        
        if (v.isConstant) {
            if (typeof(v.constantValue) == "string") {
                let [offset, len] = this.module.addString(v.constantValue);
                let s: Wasm32Storage = {storageType: "global_strings", offset: offset};
                this.varStorage.set(v, s);                    
                return;
            } else if (v.constantValue instanceof Array) {
                let data = this.encodeLiteral(v.type, v.constantValue as BinaryData);
                let offset = this.module.addBinary(data)
                let s: Wasm32Storage = {storageType: "global_heap", offset: offset};
                this.varStorage.set(v, s);
                return;
            } else {
                throw "Implementation error";
            }
        }

        if (!v.usedInMultipleSteps && !(v.type instanceof StructType) && !v.gcDiscoverable && !v.addressable) {
            // Non-struct variables (which are not GC-relevant) are stored in local variables.
            let index = locals.allocate(v.type);
            let s: Wasm32Storage = {storageType: "local_var", offset: index};
            this.varStorage.set(v, s);
        } else if (v.usedInMultipleSteps && !(v.type instanceof StructType) && !v.addressable) {
            // Non-struct variables (which are are used in multiple steps of an async func)
            // are stored in local variables and in addition on the heap stack when the function yields
            let index = locals.allocate(v.type);
            let s: Wasm32Storage = {storageType: "local_var", offset: index};
            this.varStorage.set(v, s);
            let indexAlternative = this.varsFrame.addField(v.name, v.type);
            let sAlternative: Wasm32Storage = {storageType: "vars", offset: indexAlternative};
            this.varAsyncStorage.set(v, sAlternative);
        } else if (!(v.type instanceof StructType) && !v.addressable) {
            // Non-struct variables (which are GC-relevant) are stored in local variables and in addition on the heap stack where GC can find them.
            let index = locals.allocate(v.type);
            let s: Wasm32Storage = {storageType: "local_var", offset: index};
            this.varStorage.set(v, s);
            let indexAlternative = this.varsFrame.addField(v.name, v.type);
            let sAlternative: Wasm32Storage = {storageType: "vars", offset: indexAlternative};
            this.varGCStorage.set(v, sAlternative);
        } else {
            let index = this.varsFrame.addField(v.name, v.type);
            let s: Wasm32Storage = {storageType: "vars", offset: index};
            this.varStorage.set(v, s);
        }
        this.localVariables.push(v);
    }

    private emitSteps() {
        for(let i = 0; i < this.steps.length; i++) {
            let n = this.steps[i];
            let c: Array<wasm.Node> = [];
            c.push(new wasm.Comment("STEP " + i.toString()));
            this.emitStep(i, n.next[0], null, c, this.steps.length - i - 1 + this.asyncCalls.length);
            this.stepCode.push(c);
        }
    }

    /**
     * 'depth' is the nesting of block/loop/if constructs.
     * This is required to branch to the function's main loop.
     */
    private emitStep(step: number, start: Node, end: Node | null, code: Array<wasm.Node>, depth: number) {
        code.push(new wasm.End());
        this.emitCode(step, start, end, code, depth, 0)
    }

    private emitCode(step: number, start: Node, end: Node | null, code: Array<wasm.Node>, depth: number, additionalDepth: number) {
        let n = start;
        for( ; n && n != end; ) {
            code.push(new wasm.Comment(n.toString("")));
            if (n.kind == "step") {
                break;
            } else if (n.kind == "if") {
                if (n.type instanceof StructType) {
                    throw "Implementation error"
                }
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n.args[0], "wasmStack", 0, code);
                code.push(new wasm.If());
                this.emitCode(step, n.next[0], n.blockPartner, code, depth, additionalDepth + 1);
                if (n.next[1]) {
                    code.push(new wasm.Else());
                    this.emitCode(step, n.next[1], n.blockPartner, code, depth, additionalDepth + 1);
                }
                code.push(new wasm.End());
                n = n.blockPartner.next[0];
            } else if (n.kind == "loop") {
                code.push(new wasm.Loop());
                this.emitCode(step, n.next[0], n.blockPartner, code, depth, additionalDepth + 1);
                code.push(new wasm.End());
                n = n.blockPartner.next[0];
            } else if (n.kind == "br") {
                code.push(new wasm.Br(n.args[0] as number));
                n = n.next[0];
            } else if (n.kind == "br_if") {
                this.emitAssign("i32", n.args[0], "wasmStack", 0, code);
                code.push(new wasm.BrIf(n.args[1] as number));
                n = n.next[0];
            } else if (n.kind == "block") {
                code.push(new wasm.Block());
                this.emitCode(step, n.next[0], n.blockPartner, code, depth, additionalDepth + 1);
                code.push(new wasm.End());
                n = n.blockPartner.next[0];
            } else if (n.kind == "goto_step") {
                if (n.name == "<end>") {
                    code.push(new wasm.Constant("i32", 0));
                    code.push(new wasm.Return());
                } else {
                    let s = this.stepNumber(n.blockPartner);
                    if (s == step + 1 && additionalDepth == 0) {
                        // Do nothing by intention. Just fall through
                    } else if (s > step) {
                        code.push(new wasm.Comment("goto_step " + n.name));
                        code.push(new wasm.Br(s - step + additionalDepth - 1));
                    } else {
                        code.push(new wasm.Comment("goto_step " + n.name));
                        code.push(new wasm.Constant("i32", this.stepsByName.get(n.name)));
                        code.push(new wasm.SetLocal(this.stepLocal));
                        code.push(new wasm.Br(depth + additionalDepth));
                    }
                }
                break;
            } else if (n.kind == "goto_step_if") {
                this.emitAssign("i32", n.args[0], "wasmStack", 0, code);
                if (n.name == "<end>") {
                    code.push(new wasm.If());
                    code.push(new wasm.Constant("i32", 0));
                    code.push(new wasm.Return());
                    code.push(new wasm.End());                
                } else {
                    let s = this.stepNumber(n.blockPartner);
                    if (s > step) {
                        code.push(new wasm.Comment("goto_step_if " + n.name));
                        code.push(new wasm.BrIf(s - step + additionalDepth - 1));
                    } else {
                        code.push(new wasm.If());
                        code.push(new wasm.Constant("i32", this.stepsByName.get(n.name)));
                        code.push(new wasm.SetLocal(this.stepLocal));
                        code.push(new wasm.Br(depth + additionalDepth + 1));
                        code.push(new wasm.End());
                    }
                }
                n = n.next[0];
            } else if (n.kind == "yield") {
                code.push(new wasm.Br(depth + additionalDepth - this.asyncCalls.length + this.asyncCallCode.length));
                n = n.next[0];
                if (!n || n.kind != "goto_step") {
                    throw "yield must be followed by goto_step";
                }
                if (n.name == "<end>") {
                    throw "goto_step after yield must not return";
                }
                let nextStep = this.stepNumberFromName(n.name);
                let c: Array<wasm.Node> = [];
                c.push(new wasm.Comment("ASYNC CALL " + this.asyncCallCode.length.toString()));
                c.push(new wasm.End());
                c.push(new wasm.Constant("i32", nextStep));
                c.push(new wasm.SetLocal(this.stepLocal));
//                c.push(new wasm.Constant("i32", 0));
//                c.push(new wasm.SetLocal(this.spLocal));
                c.push(new wasm.Br(this.asyncCalls.length - this.asyncCallCode.length));
                this.asyncCallCode.push(c);
            } else if (n.kind == "call_begin") {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error"
                }
                // Allocate a stack frame (if required)
                if (n.type.stackFrame.size > 0) {
                    // Allocate space on the stack                    
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", n.type.stackFrame.size));
                    code.push(new wasm.BinaryInstruction("i32", "sub"));
                    code.push(new wasm.SetLocal(this.spLocal));
                }
                code.push(new wasm.Constant("i32", 0xffffffff)); // Initialization step
                // Put parameters on stack
                for(let i = 1; i < n.args.length; i++) {
                    if (n.type.params[i-1] instanceof FunctionType) {
                        throw "Implementation error"
                    }
                    // Pointers as arguments must be passed on the stack
                    if (n.type.params[i-1] instanceof StructType || n.type.params[i-1] == "ptr") {
                        this.emitAssign(n.type.params[i-1], n.args[i], "heapStack", n.type.stackFrame.fieldOffset("$p" + (i-1).toString()), code);
                    } else {
                        this.emitAssign(n.type.params[i-1], n.args[i], "wasmStack", 0, code);                        
                    }
                }
                code.push(new wasm.GetLocal(this.spLocal));
                // Call the function
                code.push(new wasm.Call(n.args[0] as number));
                code.push(new wasm.TeeLocal(this.asyncReturnLocal));
                // If the call returned with '!=0', the call returned async
                code.push(new wasm.BrIf(depth + additionalDepth - this.asyncCalls.length + this.asyncCallCode.length));
                n = n.next[0];
                if (!n || n.kind != "goto_step") {
                    throw "call_begin must be followed by goto_step";
                }
                if (n.name == "<end>") {
                    throw "goto_step after call_begin must not return";
                }
                let nextStep = this.stepNumberFromName(n.name);
                // Go to the next step?
                if (nextStep == step + 1) {
                    // Nothing to do: Just fall through to the next step
                    n = n.next[0];
                }
                let c: Array<wasm.Node> = [];
                c.push(new wasm.Comment("ASYNC CALL " + this.asyncCallCode.length.toString()));
                c.push(new wasm.End());
                c.push(new wasm.Constant("i32", nextStep));
                c.push(new wasm.SetLocal(this.stepLocal));
                c.push(new wasm.Br(this.asyncCalls.length - this.asyncCallCode.length));
                this.asyncCallCode.push(c);
            } else if (n.kind == "call_end") {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error"
                }
                if (n.assign) {
                    if (n.type.result instanceof StructType) {
                        // Put destination addr on wasm stack
                        let destOffset = this.emitAddrOfVariable(n.assign, true, code);
                        // Copy from the stack into the destination
                        code.push(new wasm.GetLocal(this.spLocal));
                        this.emitCopy(n.type.result, n.type.stackFrame.fieldOffset("$result"), destOffset, code);
                    } else {
                        this.storeVariableFromWasmStack1(n.type.result, n.assign, code);
                        let width: wasm.StackType = this.stackTypeOf(n.type.result);
                        let asWidth: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u" = null;
                        switch (n.type.result) {
                            case "i8":
                                asWidth = "8_u";
                                break;
                            case "s8":
                                asWidth = "8_s";
                                break;
                            case "i16":
                                asWidth = "16_u";
                                break;
                            case "s16":
                                asWidth = "16_s";
                                break;
                        }
                        code.push(new wasm.GetLocal(this.spLocal));
                        code.push(new wasm.Load(width, asWidth, n.type.stackFrame.fieldOffset("$result")));            
                        this.storeVariableFromWasmStack2(n.type.result, n.assign, false, code);
                    }
                }
                // Remove the entire stack frame
                if (n.type.stackFrame.size > 0) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", n.type.stackFrame.size));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                    code.push(new wasm.SetLocal(this.spLocal));
                }
                n = n.next[0];
            } else if (n.kind == "store") {
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
                // Get the destination addr
                this.emitWordAssign("addr", n.args[0], "wasmStack", code);
                if (typeof(n.args[1]) != "number") {
                    throw "Implementation error: second arg to store is always a number";
                }
                if (n.args[2] instanceof Node && (n.args[2] as Node).kind == "call_end") {
                    let call_end = n.args[2] as Node;
                    let call_type = call_end.type as FunctionType;
                    // Copy from the stack into the destination
                    code.push(new wasm.GetLocal(this.spLocal));
                    this.emitCopy(n.type, call_type.stackFrame.fieldOffset("$result"), n.args[1] as number, code);
                    // Remove the stack frame                  
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", call_type.stackFrame.size));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                    code.push(new wasm.SetLocal(this.spLocal));
                } else {
                    // Copy the value to the destination address
                    this.emitAssign(n.type, n.args[2], "heap", n.args[1] as number, code);
                }
                n = n.next[0];
            } else if (n.kind == "addr_of") {
                if (n.type instanceof FunctionType || n.type instanceof StructType || !n.assign) {
                    throw "Implementation error"
                }
                if (!(n.args[0] instanceof Variable)) {
                    throw "Implementation error"                    
                }
                this.emitAssign("addr", n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "load") {
                if (n.type instanceof FunctionType || !n.assign) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "wrap" || n.kind == "extend" || n.kind == "convert32_s" || n.kind == "convert32_u" || n.kind == "convert64_s" || n.kind == "convert64_u") {
                if (n.type instanceof FunctionType || n.type instanceof StructType || !n.assign) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "promote" || n.kind == "demote" || n.kind == "trunc32" || n.kind == "trunc64") {
                if (n.type instanceof FunctionType || n.type instanceof StructType || !n.assign) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "const" || this.isBinaryInstruction(n.kind) || this.isUnaryInstruction(n.kind)) {
                if (n.type instanceof FunctionType || !n.assign) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "call" || n.kind == "call_indirect") {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type.result, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "spawn" || n.kind == "spawn_indirect") {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error"
                }
                // Store the sp
                let sp = this.allocLocal("addr");
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.SetLocal(sp));
                // Create a new co-routine
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Call(this.createCoroutineFunctionIndex));
                let c = this.allocLocal("addr");
                code.push(new wasm.TeeLocal(c));
                code.push(new wasm.GetLocal(c));
                // Get the stack of this co-routine
                code.push(new wasm.Load("i32", null, 8)); // TODO: Use a symbolic name (i.e. the field sp of type Stack) instead of 8.
                code.push(new wasm.SetLocal(this.spLocal));
                // Call the function on the new stack
                this.emitAssign(n.type.result, n, null, 0, code);
                code.push(new wasm.Store("i32", null, 16)); // TODO: Use a symbolic name (i.e. the field frame of type Coroutine) instead of 8.
                // Restore the sp
                code.push(new wasm.GetLocal(sp));
                code.push(new wasm.SetLocal(this.spLocal));
                // Schedule the co-routine
                code.push(new wasm.GetLocal(c));
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Call(this.scheduleCoroutineFunctionIndex));
                this.freeLocal(c);
                n = n.next[0];
            } else if (n.kind == "return") {
                if (n.type instanceof FunctionType) {
                    throw "Implementation error";
                }
                if (n.args.length == 1 && !this.wfIsAsync && !(n.type instanceof StructType)) {
                    if (this.returnVariables.length != 1) {
                        throw "return with one parameter, but function has no return type"
                    }
                    this.emitAssign(n.type as Type, n.args[0], "wasmStack", 0, code);
                } else if (n.args.length == 1 && n.args[0] instanceof Node && (n.args[0] as Node).kind == "call_end") {
                    let call_end = n.args[2] as Node;
                    let call_type = call_end.type as FunctionType;
                    // Put the address of the return value on the wasm stack
                    code.push(new wasm.GetLocal(this.spLocal));
                    let destOffset = this.paramsFrame.size + this.varsFrame.size;
                    // Copy from the stack into the destination
                    code.push(new wasm.GetLocal(this.bpLocal));
                    this.emitCopy(n.type as Type | StructType, call_type.stackFrame.fieldOffset("$result"), 0, code);
                    // Remove the stack frame                  
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Constant("i32", call_type.stackFrame.size));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                    code.push(new wasm.SetLocal(this.spLocal));
                } else {
                    if (this.returnVariables.length != n.args.length) {
                        throw "number of return values does not match with return type"
                    }
                    for(let i = 0; i < n.args.length; i++) {
                        let t = this.returnVariables[i].type;
                        // Destination addr
//                        let destOffset = this.emitAddrOfVariable(this.returnVariables[i], true, code);
                        code.push(new wasm.GetLocal(this.bpLocal));
                        let returnOffset = this.varStorage.get(this.returnVariables[i]).offset;
                        let destOffset = this.paramsFrame.size + this.varsFrame.size + returnOffset;
//                        this.emitAssign(t, n.args[i], "heapStack", destOffset, code);
                        this.emitAssign(t, n.args[i], "heapStack", destOffset, code);
                    }
                }
                if (this.wfIsAsync) {
                    code.push(new wasm.Constant("i32", 0));
                }
                code.push(new wasm.Return());
                n = n.next[0];
            } else if (n.kind == "trap") {
                code.push(new wasm.Unreachable());
                n = n.next[0];
            } else if (n.kind == "copy") {
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "struct") {
                if (!(n.type instanceof StructType)) {
                    throw "Implementation error"
                }
                this.emitAssign(n.type, n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "decl_param" || n.kind == "decl_result" || n.kind == "decl_var") {
                n = n.next[0];
            } else if (n.kind == "alloc") {
                if (n.type instanceof FunctionType) {
                    throw "Implementation error"
                }
//                if (n.type != "addr" && n.type != "ptr") {
//                    throw "Implementation error"
//                }
                this.emitAssign("ptr", n, null, 0, code);
                n = n.next[0];
            } else if (n.kind == "end") {
                // Nothing to do
                n = n.next[0];
            } else {
                // TODO: This clause should never trigger
                throw "TODO " + n.toString("");
//                n = n.next[0];
            }
        }
    }

    /**
     */
    private emitAssign(type: Type | StructType | PointerType, n: Node | Variable | number, dest: "heap" | "heapStack" | "wasmStack" | null, destOffset: number, code: Array<wasm.Node>) {
        if (dest === null && (n instanceof Variable || typeof(n) == "number" || (n instanceof Node && n.kind != "call" && n.kind != "call_indirect"  && n.kind != "spawn" && n.kind != "spawn_indirect" && !n.assign))) {
            throw "Implementation error: No assignment";
        }

        if (type instanceof StructType) {
            if (dest == "wasmStack") {
                throw "Implementation error: StructType on wasmStack is not possible";
            }
            // Synchronous function call that returns a StructType?
            if (n instanceof Node && (n.kind == "call" || n.kind == "call_indirect")) {
                if (!(n.type instanceof FunctionType)) {
                    throw "Implementation error " + n.toString("");
                }
                if (!(n.type.result instanceof StructType)) {
                    throw "Implementation error.";
                }
                let assignOffset = 0;
                if (n.assign) {
                    // Put destination addr on stack
                    assignOffset = this.emitAddrOfVariable(n.assign, true, code);
                }
                let stackSubtract = n.type.stackFrame.size;
                // If the result should end up somewhere on the heapStack, create the stack frame right there
                if (dest == "heapStack") {
                    // Put the destination address on the stack
                    // It must hold that the destination address is above the SP
                    code.push(new wasm.GetLocal(this.spLocal));                
//                    stackSubtract -= destOffset;
                }
                // Make room for the stack frame on the heap stack
                code.push(new wasm.Comment("Create stack frame"));
                code.push(new wasm.GetLocal(this.spLocal));
//                if (stackSubtract < 0) {
//                    code.push(new wasm.Constant("i32", -stackSubtract));
//                    code.push(new wasm.BinaryInstruction("i32", "add"));
//                } else {
                code.push(new wasm.Constant("i32", stackSubtract));
                code.push(new wasm.BinaryInstruction("i32", "sub"));
//                }
                code.push(new wasm.SetLocal(this.spLocal));
                // Put parameters on wasm/heap stack
                let paramTypes: Array<wasm.StackType> = [];
                for(let i = 0; i < n.type.params.length; i++) {
                    code.push(new wasm.Comment("parameter " + i.toString()));
                    // Pointers must be passed on the stack, too
                    if (n.type.params[i] instanceof StructType) {
//                    code.push(new wasm.Comment(">>parameter " + i.toString()));
//                        code.push(new wasm.GetLocal(this.spLocal));
//                    code.push(new wasm.Comment("<<parameter " + i.toString()));
                        this.emitAssign(n.type.params[i], n.args[i+1], "heapStack", n.type.stackFrame.fieldOffset("$p" + i.toString()), code);
                    } else {
                        if (n.kind == "call_indirect") {
                            paramTypes.push(this.stackTypeOf(n.type.params[i] as Type));
                        }
                        this.emitAssign(n.type.params[i], n.args[i+1], "wasmStack", 0, code);                    
                        if (n.type.params[i] == "ptr" && i + 1 < n.type.params.length) {
                            // TODO: If GC can happen before the call, store the ptr where GC can find it
                        }
                    }
                }
                if (n.type.callingConvention == "fyr" || n.type.callingConvention == "fyrCoroutine") {
                    // Put SP on wasm stack
                    code.push(new wasm.GetLocal(this.spLocal));
                    if (n.kind == "call_indirect") {
                        paramTypes.push("i32");
                    }
                }
                if (n.kind == "call_indirect") {
                    this.emitAssign("s32", n.args[0], "wasmStack", 0, code);
                    let typeName = this.module.addFunctionType(paramTypes, []);
                    code.push(new wasm.CallIndirect(typeName));
                } else {
                    code.push(new wasm.Call(n.args[0] as number | string));
                }
                // Assign
                if (n.assign) {
                    // Copy the struct from the heapStack to the assigned variable
                    code.push(new wasm.GetLocal(this.spLocal));
                    this.emitCopy(n.type.result, n.type.stackFrame.fieldOffset("$result"), assignOffset, code);
                }
                if (dest == "heap" || dest == "heapStack") {
                    // Copy the struct from the heapStack to the destination address that is already on the stack.
                    // This consumes the destination address
                    code.push(new wasm.GetLocal(this.spLocal));
                    this.emitCopy(n.type.result, n.type.stackFrame.fieldOffset("$result"), destOffset, code);
                }
                // Remove the stack frame and restore the SP
                code.push(new wasm.Comment("Remove stack frame and restore the SP"));
                code.push(new wasm.GetLocal(this.spLocal));
//                if (stackSubtract < 0) {
//                    code.push(new wasm.Constant("i32", -stackSubtract));
//                    code.push(new wasm.BinaryInstruction("i32", "sub"));
//                } else {
                code.push(new wasm.Constant("i32", stackSubtract));
                code.push(new wasm.BinaryInstruction("i32", "add"));
//                }
                code.push(new wasm.SetLocal(this.spLocal));
                return;
            }

            // Constructing a struct?
            if (n instanceof Node && n.kind == "struct") {
                // Put the destination addr on the stack (if it is not already there or if it is the SP)
                if (dest === null) {
                    destOffset = this.emitAddrOfVariable(n.assign, true, code);
                }

                // An optimization:
                // If the struct consists of zeros only, and has more than 8 elements, we can generate slightly better code.
                if (this.allMemZero(type, n.args) > 8 && (dest === null || !n.assign)) {
                    if (dest == "heapStack") {
                        code.push(new wasm.GetLocal(this.spLocal));
                    }
                    if (destOffset != 0) {
                        code.push(new wasm.Constant("i32", 0));
                        code.push(new wasm.BinaryInstruction("i32", "add"));
                    }
                    code.push(new wasm.Constant("i32", sizeOf(type)));
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call("$memZero"));
                    return;
                }

                let addrLocal: number;
                if (dest != "heapStack") {
                    // Copy the destination address to a local variable
                    addrLocal = this.allocLocal("i32");
                    code.push(new wasm.SetLocal(addrLocal));
                }

                // Check whether there are large structs/arrays which are not explicitly initialized and must therefore be zero'd.
                // If more than 8 fields must be zero'd we assume that nulling the entire struct is cheaper.
                // TODO: Measure what is best here
                let hasMemZero = false;
                if (this.needsMemZero(type, n.args) > 8) {
                    hasMemZero = true;
                    if (dest == "heapStack") {
                        code.push(new wasm.GetLocal(this.spLocal));
                    } else {
                        code.push(new wasm.GetLocal(addrLocal));
                    }
                    if (destOffset != 0) {
                        code.push(new wasm.Constant("i32", 0));
                        code.push(new wasm.BinaryInstruction("i32", "add"));
                    }
                    code.push(new wasm.Constant("i32", sizeOf(type)));
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call("$memZero"));
                }                
                // Compute the field values and store them
                let args = 0;
                for(let i = 0; i < type.fields.length; i++) {
                    if (args >= n.args.length) {
                        throw "Implementation errro";
                    }
                    let f = type.fields[i];
                    let name: string = f[0];
                    let t: Type | StructType | PointerType = f[1];
                    let count = f[2];
                    let size = sizeOf(t);
                    let arrOffset = 0;
                    for(let j = 0; j < count; j++, arrOffset += size) {
                        if (dest == "heapStack") {
                            if (n.args[args] === 0 && !hasMemZero && t instanceof StructType) {
                                this.emitAssignZeroStruct(this.spLocal, t, destOffset + type.fieldOffset(name) + arrOffset, code)
                            } else if (n.args[args] !== 0 || !hasMemZero) {
                                this.emitAssign(t, n.args[args], "heapStack", destOffset + type.fieldOffset(name) + arrOffset, code);
                            }
                        } else {
                            if (n.args[args] === 0 && !hasMemZero && t instanceof StructType) {
                                this.emitAssignZeroStruct(addrLocal, t, destOffset + type.fieldOffset(name) + arrOffset, code);
                            } else if (n.args[args] !== 0 || !hasMemZero) {
                                // TODO: Just pass along in which local variable the address is stored
                                code.push(new wasm.GetLocal(addrLocal));
                                this.emitAssign(t, n.args[args], "heap", destOffset + type.fieldOffset(name) + arrOffset, code);
                            }
                        }
                        args++;
                    }
                }

                if (n.assign && dest !== null) {
                    // Put the source address on the stack
                    if (dest == "heapStack") {
                        code.push(new wasm.GetLocal(this.spLocal));
                    } else {
                        code.push(new wasm.GetLocal(addrLocal));
                    }
                    let assignOffset = this.emitAddrOfVariable(n.assign, true, code);
                    this.emitCopy(type, destOffset, assignOffset, code);
//                } else if (dest == "heap" || n.assign) {
//                    code.push(new wasm.Drop());
                }

                if (dest != "heapStack") {
                    // Copy the destination address to a local variable
                    this.freeLocal(addrLocal);
                }
                return;
            }

            // An expression of type StructType?
            if (typeof(n) == "number") {
                throw "Implementation error: A number cannot be of type StructType " + type.name;
            } else if (n instanceof Variable) {
                let srcOffset = this.emitAddrOfVariable(n, true, code);
                if (dest === "heapStack") {
                    code.push(new wasm.GetLocal(this.spLocal));
                }
                this.emitCopy(type, srcOffset, destOffset, code);
            } else if (n instanceof Node) {
                if (n.kind == "copy" || n.kind == "load") {
                    let tmp: number;
                    let assignDest: "heap" | "heapStack" = "heap"
                    // Put the destination addr on the stack (if it is not already there)
                    if (dest === null) {
                        destOffset = this.emitAddrOfVariable(n.assign, true, code);
                    } else if (dest === "heapStack") {
                        assignDest = "heapStack";
                        code.push(new wasm.GetLocal(this.spLocal));
                    } else if (dest === "heap" && n.assign) {
                        // Duplicate the heap addr in case we need to copy the value to the assigned variable
                        let tmp = this.getTmpLocal("i32");
                        code.push(new wasm.TeeLocal(tmp));
//                        code.push(new wasm.GetLocal(tmp));
                    }
                    // Copy the value
                    if (n.kind == "load") {
                        this.emitAssign("addr", n.args[0], "wasmStack", 0, code);
                        this.emitCopy(type, n.args[1] as number, destOffset, code);
                    } else {
                        this.emitAssign(type, n.args[0], assignDest, destOffset, code);
                    }
                    // Assign and dest?
                    if (n.assign && dest !== null) {
                        // Put the destination address on the stack
                        let assignOffset = this.emitAddrOfVariable(n.assign, true, code);
                        // Put the source address on the stack (unless it is already there)
                        if (dest == "heapStack") {
                            code.push(new wasm.GetLocal(this.spLocal));
                        } else if (dest == "heap") {
                            code.push(new wasm.GetLocal(tmp));
                        }
                        this.emitCopy(type, destOffset, assignOffset, code);
                    }
                }
            } else {
                throw "Implementation error: Node " + (n as Node).kind + " cannot yield a StructType";
            }
            return;
        }

        //
        // The expression is of a type that can be put on the wasm stack
        //

        if (dest == "heapStack") {
            code.push(new wasm.GetLocal(this.spLocal));
        }
        this.emitWordAssign(type, n, dest !== null ? "wasmStack" : null, code);
        if (dest == "heapStack" || dest == "heap") {
            let width: wasm.StackType = this.stackTypeOf(type);
            let asWidth: null | "8"| "16" | "32" = null;
            switch (type) {
                case "i8":
                case "s8":
                    asWidth = "8";
                    break;
                case "i16":
                case "s16":
                    asWidth = "16";
                    break;
            }
            code.push(new wasm.Store(width, asWidth, destOffset));
        }
    }

    private emitAssignZeroStruct(local: number, type: StructType, destOffset: number, code: Array<wasm.Node>) {
        for(let i = 0; i < type.fields.length; i++) {
            let f = type.fields[i];
            let name: string = f[0];
            let t: Type | StructType | PointerType = f[1];
            let count = f[2];
            let size = sizeOf(t);
            let arrOffset = 0;
            for(let j = 0; j < count; j++, arrOffset += size) {
                if (t instanceof StructType) {
                    this.emitAssignZeroStruct(local, t, destOffset + type.fieldOffset(name) + arrOffset, code);
                } else {
                    code.push(new wasm.GetLocal(local));
                    this.emitAssign(t, 0, "heap", destOffset + type.fieldOffset(name) + arrOffset, code);
                }
                arrOffset += size;
            }
        }
    }

    private emitCopy(type: Type | StructType | PointerType, srcOffset: number, destOffset: number, code: Array<wasm.Node>) {
        let size = sizeOf(type);
        let align = alignmentOf(type);
        switch (size) {
            case 1:
                code.push(new wasm.Load("i32", "8_u", srcOffset, align));
                code.push(new wasm.Store("i32", "8", destOffset, align));
                break;
            case 2:
                code.push(new wasm.Load("i32", "16_u", srcOffset, align));
                code.push(new wasm.Store("i32", "16", destOffset, align));
                break;
            case 4:
                code.push(new wasm.Load("i32", null, srcOffset, align));
                code.push(new wasm.Store("i32", null, destOffset, align));
                break;
            case 8:
                code.push(new wasm.Load("i64", null, srcOffset, align));
                code.push(new wasm.Store("i64", null, destOffset, align));
                break;
            case 12:
            {
                let src = this.getTmpLocal("src");
                code.push(new wasm.SetLocal(src));
                let dest = this.getTmpLocal("dest");
                code.push(new wasm.TeeLocal(dest));
                code.push(new wasm.GetLocal(src));
                code.push(new wasm.Load("i64", null, srcOffset, align));
                code.push(new wasm.Store("i64", null, destOffset, align));
                code.push(new wasm.GetLocal(dest));
                code.push(new wasm.GetLocal(src));
                code.push(new wasm.Load("i32", null, 8 + srcOffset, align));
                code.push(new wasm.Store("i32", null, 8 + destOffset, align));
                break;
            }
            case 16:
            {
                let src = this.getTmpLocal("src");
                code.push(new wasm.SetLocal(src));
                let dest = this.getTmpLocal("dest");
                code.push(new wasm.TeeLocal(dest));
                code.push(new wasm.GetLocal(src));
                code.push(new wasm.Load("i64", null, srcOffset, align));
                code.push(new wasm.Store("i64", null, destOffset, align));
                code.push(new wasm.GetLocal(dest));
                code.push(new wasm.GetLocal(src));
                code.push(new wasm.Load("i64", null, 8 + srcOffset, align));
                code.push(new wasm.Store("i64", null, 8 + destOffset, align));
                break;
            }
            default:
            {
                if (destOffset != 0) {
                    let tmp = this.getTmpLocal("i32");
                    code.push(new wasm.SetLocal(tmp));
                    code.push(new wasm.Constant("i32", destOffset));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                    code.push(new wasm.GetLocal(tmp));
                }
                if (srcOffset != 0) {
                    code.push(new wasm.Constant("i32", srcOffset));
                    code.push(new wasm.BinaryInstruction("i32", "add"));                    
                }
                code.push(new wasm.Constant("i32", sizeOf(type)));
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Call(this.copyFunctionIndex));
                break;
            }
        }
    }

    private emitAddrOfVariable(v: Variable, returnOffset: boolean, code: Array<wasm.Node>): number {
        let s = this.storageOf(v);
        switch(s.storageType) {
            case "vars":
                code.push(new wasm.GetLocal(this.bpLocal));
                let offset = this.varsFrame.fieldOffset(v.name);
                if (returnOffset) {
                    return offset;
                }
                if (offset != 0) {
                    code.push(new wasm.Constant("i32", offset));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                }
                break;                
            case "params":
            {
                code.push(new wasm.GetLocal(this.bpLocal));
                let offset = this.varsFrame.size + this.paramsFrame.fieldOffset(v.name);
                if (returnOffset) {
                    return offset;
                }
                if (offset != 0) {
                    code.push(new wasm.Constant("i32", offset));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                }
                break;                
            }
            case "result":
            {
                code.push(new wasm.GetLocal(this.bpLocal));
                let offset = this.varsFrame.size + this.paramsFrame.size + this.resultFrame.fieldOffset(v.name);
                if (returnOffset) {
                    return offset;
                }
                if (offset != 0) {
                    code.push(new wasm.Constant("i32", offset));
                    code.push(new wasm.BinaryInstruction("i32", "add"));
                }
                break;
            }      
            case "global_heap":
            {
                code.push(new wasm.Constant("i32", s.offset));
                break;
            }
            default:
                throw "Implementation error"
        }
        return 0;
    }

    private emitWordAssign(type: Type | PointerType, n: Node | Variable | number, stack: "wasmStack" | null, code: Array<wasm.Node>) {
        if (stack == null && (n instanceof Variable || typeof(n) == "number" || (n.kind != "call" && n.kind != "call_indirect" && n.kind != "spawn" && n.kind != "spawn_indirect" && !n.assign))) {
            throw "Implementation error: No assignment"
        }

        if (n instanceof Node) {
            return this.emitWordNode(n, stack, code);
        } else if (n instanceof Variable) {
            return this.emitWordVariable(type, n, code);
        } else {
            let width: wasm.StackType = this.stackTypeOf(type);
            code.push(new wasm.Constant(width, n));
        }
    }

    private emitWordVariable(type: Type | PointerType, v: Variable, code: Array<wasm.Node>) {
        let width: wasm.StackType = this.stackTypeOf(type);
        let asWidth: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u" = null;
        switch (type) {
            case "i8":
                asWidth = "8_u";
                break;
            case "s8":
                asWidth = "8_s";
                break;
            case "i16":
                asWidth = "16_u";
                break;
            case "s16":
                asWidth = "16_s";
                break;
        }        
        let s = this.storageOf(v);
        switch(s.storageType) {
            case "local":
                code.push(new wasm.GetLocal(s.offset));
                break;
            case "vars":
                code.push(new wasm.GetLocal(this.bpLocal));
                code.push(new wasm.Load(width, asWidth, this.varsFrame.fieldOffset(v.name)));
                break;                
            case "params":
                code.push(new wasm.GetLocal(this.bpLocal));
                code.push(new wasm.Load(width, asWidth, this.varsFrame.size + this.paramsFrame.fieldOffset(v.name)));
                break;                
            case "result":
                code.push(new wasm.GetLocal(this.bpLocal));
                code.push(new wasm.Load(width, asWidth, this.varsFrame.size + this.paramsFrame.size + this.resultFrame.fieldOffset(v.name)));
                break;      
            case "global":
//                console.log("GET", v.name, s.offset);
                code.push(new wasm.GetGlobal(s.offset));
                break;
            case "global_heap":
                // let st = this.globalVarStorage.get(v);
                code.push(new wasm.Constant("i32", s.offset));
                code.push(new wasm.Load(width, asWidth, 0));
                break;
            case "global_strings":
                // let st = this.globalVarStorage.get(v);
                code.push(new wasm.Constant("i32", s.offset));
                break;
        }
    }

    /**
     * Emits code for Node 'n'. The result of the node is a word-type (i.e. it fits on the WASM stack).
     * The result is either assigned to a variable or put on the wasm stack or both or no
     * assignment happens at all.
     */
    private emitWordNode(n: Node, stack: "wasmStack" | null, code: Array<wasm.Node>) {
        if (n.kind == "alloc") {
            if (n.assign) {
                this.storeVariableFromWasmStack1("addr", n.assign, code);
            }
            let size = sizeOf(n.type as Type | StructType);
            this.emitWordAssign("i32", n.args[0], "wasmStack", code);
            code.push(new wasm.Constant("i32", size));
            if (n.args.length == 2) {
                let headType = (n.args[1] as Variable).type;
                let headSize = sizeOf(headType);
                code.push(new wasm.Constant("i32", headSize));
            } else {
                code.push(new wasm.Constant("i32", 0));                
            }
            code.push(new wasm.GetLocal(this.spLocal));
            code.push(new wasm.Call(this.allocFunctionIndex));
            if (n.assign) {
                this.storeVariableFromWasmStack2("addr", n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "addr_of") {
            if (n.assign) {
                this.storeVariableFromWasmStack1("addr", n.assign, code);
            }
            this.emitAddrOfVariable(n.args[0] as Variable, false, code);
            if (n.assign) {
                this.storeVariableFromWasmStack2("addr", n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "const") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            let width: wasm.StackType = this.stackTypeOf(n.type);
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            code.push(new wasm.Constant(width, n.args[0] as number));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "load") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign("addr", n.args[0], "wasmStack", code);
            let width: wasm.StackType = this.stackTypeOf(n.type);
            let asWidth: null | "8_s" | "8_u" | "16_s" | "16_u" | "32_s" | "32_u" = null;
            switch (n.type) {
                case "i8":
                    asWidth = "8_u";
                    break;
                case "s8":
                    asWidth = "8_s";
                    break;
                case "i16":
                    asWidth = "16_u";
                    break;
                case "s16":
                    asWidth = "16_s";
                    break;
            }
            code.push(new wasm.Load(width, asWidth, n.args[1] as number));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (this.isBinaryInstruction(n.kind)) {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            this.emitWordAssign(n.type, n.args[1], "wasmStack", code);
            let width: wasm.StackType = this.stackTypeOf(n.type);
            code.push(new wasm.BinaryInstruction(width, n.kind as wasm.BinaryOp));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (this.isUnaryInstruction(n.kind)) {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            let width: wasm.StackType = this.stackTypeOf(n.type);
            code.push(new wasm.BinaryInstruction(width, n.kind as wasm.BinaryOp));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "extend") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            code.push(new wasm.Extend(isSigned(n.type)));
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "wrap") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            code.push(new wasm.Wrap());
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "demote" || n.kind == "promote") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            if (n.kind == "demote") {
                code.push(new wasm.Demote());
            } else {
                code.push(new wasm.Promote());
            }            
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "trunc64" || n.kind == "trunc32") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            if (n.kind == "trunc32") {
                code.push(new wasm.Trunc(this.stackTypeOf(n.type) as "i32" | "i64", "f32", n.type == "s32" || n.type == "s64"));
            } else {
                code.push(new wasm.Trunc(this.stackTypeOf(n.type) as "i32" | "i64", "f64", n.type == "s32" || n.type == "s64"));
            }            
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "convert64_s" || n.kind == "convert64_u" || n.kind == "convert32_s" || n.kind == "convert32_u") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            if (n.kind == "convert64_s") {
                code.push(new wasm.Convert(this.stackTypeOf(n.type) as "f32" | "f64", "i64", true));
            } else if (n.kind == "convert64_u") {
                code.push(new wasm.Convert(this.stackTypeOf(n.type) as "f32" | "f64", "i64", false));
            } else if (n.kind == "convert32_s") {
                code.push(new wasm.Convert(this.stackTypeOf(n.type) as "f32" | "f64", "i32", true));
            } else if (n.kind == "convert32_u") {
                code.push(new wasm.Convert(this.stackTypeOf(n.type) as "f32" | "f64", "i32", false));
            }            
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "copy") {
            if (n.type instanceof StructType || n.type instanceof FunctionType) {
                throw "Implementation error " + n.toString("");
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type, n.assign, code);
            }
            this.emitWordAssign(n.type, n.args[0], "wasmStack", code);
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type, n.assign, stack == "wasmStack", code);
            }
            n = n.next[0];
        } else if (n.kind == "call" || n.kind == "call_indirect" || n.kind == "spawn" || n.kind == "spawn_indirect") { // TODO: spawn_indirect
            if (!(n.type instanceof FunctionType)) {
                throw "Implementation error " + n.toString("");
            }
            if (n.type.result instanceof StructType) {
                throw "Implementation error. StructType returns are handled elsewhere";
            }
            if (n.assign) {
                this.storeVariableFromWasmStack1(n.type.result as Type, n.assign, code);
            }
            // Allocate a stack frame
            if (n.type.stackFrame.size > 0) {
                // Save the stack pointer
                code.push(new wasm.Comment("Create stack frame for " + (n.args[0] as number).toString()));
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Constant("i32", n.type.stackFrame.size));
                code.push(new wasm.BinaryInstruction("i32", "sub"));
                code.push(new wasm.SetLocal(this.spLocal));
            }
            if (n.kind == "spawn") {
                // Put the step number on the stack
                code.push(new wasm.Constant("i32", 0xfffffffe));
            }
            // Put parameters on the stack
            let paramTypes: Array<wasm.StackType> = [];
            for(let i = 0; i < n.type.params.length; i++) {
                code.push(new wasm.Comment("parameter " + i.toString()));
                // Structs must be passed on the stack
                if (n.type.params[i] instanceof StructType) {
                    this.emitAssign(n.type.params[i], n.args[i+1], "heapStack", n.type.stackFrame.fieldOffset("$p" + i.toString()), code);
                } else {
                    if (n.kind == "call_indirect") {
                        paramTypes.push(this.stackTypeOf(n.type.params[i] as Type))
                    }
                    this.emitAssign(n.type.params[i], n.args[i+1], "wasmStack", 0, code);                    
                }
            }
            if (n.type.callingConvention == "fyr" || n.type.callingConvention == "fyrCoroutine") {
                if (n.kind == "call_indirect") {
                    paramTypes.push("i32");
                }
                code.push(new wasm.GetLocal(this.spLocal));
            }
            // Call the function
            if (n.args[0] < 0) {
                if (n.args[0] == SystemCalls.heap) {
                    code.push(new wasm.GetGlobal(this.heapGlobalVariableIndex));
                } else if (n.args[0] == SystemCalls.currentMemory) {
                    code.push(new wasm.CurrentMemory());
                } else if (n.args[0] == SystemCalls.growMemory) {
                    code.push(new wasm.GrowMemory());
                } else if (n.args[0] == SystemCalls.heapTypemap) {
                    code.push(new wasm.GetGlobal(this.typemapGlobalVariableIndex));
                } else if (n.args[0] == SystemCalls.pageSize) {
                    code.push(new wasm.Constant("i32", 1 << 16));
                } else if (n.args[0] == SystemCalls.defaultStackSize) {
                    code.push(new wasm.Constant("i32", this.stackSize));
                } else if (n.args[0] == SystemCalls.stackPointer) {
                    code.push(new wasm.GetLocal(this.spLocal));
                } else if (n.args[0] == SystemCalls.createMap) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.createMapFunctionIndex));
                } else if (n.args[0] == SystemCalls.setMap) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.setMapFunctionIndex));
                } else if (n.args[0] == SystemCalls.lookupMap) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.lookupMapFunctionIndex));                    
                } else if (n.args[0] == SystemCalls.removeMapKey) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.removeMapKeyFunctionIndex));                    
                } else if (n.args[0] == SystemCalls.hashString) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.hashStringFunctionIndex));                    
                } else if (n.args[0] == SystemCalls.setNumericMap) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.setNumericMapFunctionIndex));
                } else if (n.args[0] == SystemCalls.lookupNumericMap) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.lookupNumericMapFunctionIndex));
                } else if (n.args[0] == SystemCalls.removeNumericMapKey) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.removeNumericMapKeyFunctionIndex));
                } else if (n.args[0] == SystemCalls.decodeUtf8) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.decodeUtf8FunctionIndex));
                } else if (n.args[0] == SystemCalls.continueCoroutine) {
                    code.push(new wasm.CallIndirect("$callbackFn"));
                } else if (n.args[0] == SystemCalls.coroutine) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.currentCoroutineFunctionIndex));
                } else if (n.args[0] == SystemCalls.scheduleCoroutine) {
                    code.push(new wasm.GetLocal(this.spLocal));
                    code.push(new wasm.Call(this.scheduleCoroutineFunctionIndex));
                } else if (n.args[0] == SystemCalls.abs32) {
                    code.push(new wasm.UnaryInstruction("f32", "abs"));
                } else if (n.args[0] == SystemCalls.abs64) {
                    code.push(new wasm.UnaryInstruction("f64", "abs"));
                } else if (n.args[0] == SystemCalls.sqrt32) {
                    code.push(new wasm.UnaryInstruction("f32", "sqrt"));
                } else if (n.args[0] == SystemCalls.sqrt64) {
                    code.push(new wasm.UnaryInstruction("f64", "sqrt"));
                } else if (n.args[0] == SystemCalls.trunc32) {
                    code.push(new wasm.UnaryInstruction("f32", "trunc"));
                } else if (n.args[0] == SystemCalls.trunc64) {
                    code.push(new wasm.UnaryInstruction("f64", "trunc"));
                } else if (n.args[0] == SystemCalls.nearest32) {
                    code.push(new wasm.UnaryInstruction("f32", "nearest"));
                } else if (n.args[0] == SystemCalls.nearest64) {
                    code.push(new wasm.UnaryInstruction("f64", "nearest"));
                } else if (n.args[0] == SystemCalls.floor32) {
                    code.push(new wasm.UnaryInstruction("f32", "floor"));
                } else if (n.args[0] == SystemCalls.floor64) {
                    code.push(new wasm.UnaryInstruction("f64", "floor"));
                } else if (n.args[0] == SystemCalls.ceil32) {
                    code.push(new wasm.UnaryInstruction("f32", "ceil"));
                } else if (n.args[0] == SystemCalls.ceil64) {
                    code.push(new wasm.UnaryInstruction("f64", "ceil"));
                } else if (n.args[0] == SystemCalls.min32) {
                    code.push(new wasm.BinaryInstruction("f32", "min"));
                } else if (n.args[0] == SystemCalls.min64) {
                    code.push(new wasm.BinaryInstruction("f64", "min"));
                } else if (n.args[0] == SystemCalls.max32) {
                    code.push(new wasm.BinaryInstruction("f32", "max"));
                } else if (n.args[0] == SystemCalls.max64) {
                    code.push(new wasm.BinaryInstruction("f64", "max"));
                } else if (n.args[0] == SystemCalls.copysign32) {
                    code.push(new wasm.BinaryInstruction("f32", "copysign"));
                } else if (n.args[0] == SystemCalls.copysign64) {
                    code.push(new wasm.BinaryInstruction("f64", "copysign"));
                } else {
                    throw "Implementation error. Unknown system function " + n.args[0];
                }
            } else {
                if (n.kind == "call_indirect") {
                    this.emitAssign("s32", n.args[0], "wasmStack", 0, code);
                    let resultTypes = [];
                    if (n.type.result) {
                        resultTypes.push(n.type.result);
                    }
                    let typeName = this.module.addFunctionType(paramTypes, resultTypes);
                    code.push(new wasm.CallIndirect(typeName));
                } else {
                    code.push(new wasm.Call(n.args[0] as number));
                }
            }
            if (n.assign) {
                this.storeVariableFromWasmStack2(n.type.result as Type, n.assign, stack == "wasmStack", code);
            } else if (stack == null && n.type.result) {
                // Remove result from wasm stack
                code.push(new wasm.Drop());
            }
            if (n.type.stackFrame.size > 0) {
                code.push(new wasm.Comment("Remove parameters"));
                // Remove parameters from stack
                code.push(new wasm.GetLocal(this.spLocal));
                code.push(new wasm.Constant("i32", n.type.stackFrame.size));
                code.push(new wasm.BinaryInstruction("i32", "add"));
                code.push(new wasm.SetLocal(this.spLocal));
            }
            n = n.next[0];            
        } else {
            throw "Implementation error emitAssignWordNode " + n.kind;
        }
    }

    /**
     * @return the number of struct fields that must be zero-assigned.
     */
    private needsMemZero(type: StructType, args: Array<number | Variable | Node> | null): number {
        let zeroCount = 0;
        let argNumber = 0;
        for(let i = 0; i < type.fields.length; i++) {
            if (args != null && argNumber >= args.length) {
                throw "Implementation errro";
            }
            let f = type.fields[i];
            let name: string = f[0];
            let t: Type | StructType | PointerType = f[1];
            let count = f[2];
            let size = sizeOf(t);
            let arrOffset = 0;
            for(let j = 0; j < count; j++, arrOffset += size) {
                if (t instanceof StructType) {
                    let a: Array<number | Variable | Node> | null = (args == null || args[argNumber] === 0 ? null : (args[argNumber] as Node).args);
                    zeroCount += this.needsMemZero(t, a);
                } else if (args == null || args[argNumber] === 0) {
                    zeroCount++;
                }
                argNumber++;
            }
        }
        return zeroCount;
    }

    /**
     * @return the number of struct fields that must be zero-assigned, but just if ALL fields are zero assigned.
     *         The function returns -1 if at least one field is not zero'd.
     */
    private allMemZero(type: StructType, args: Array<number | Variable | Node> | null): number {
        let zeroCount = 0;
        let argNumber = 0;
        for(let i = 0; i < type.fields.length; i++) {
            if (args != null && argNumber >= args.length) {
                throw "Implementation errro";
            }
            let f = type.fields[i];
            let name: string = f[0];
            let t: Type | StructType | PointerType = f[1];
            let count = f[2];
            let size = sizeOf(t);
            let arrOffset = 0;
            for(let j = 0; j < count; j++, arrOffset += size) {
                if (t instanceof StructType) {
                    let a: Array<number | Variable | Node> | null = (args == null || args[argNumber] === 0 ? null : (args[argNumber] as Node).args);
                    zeroCount += this.allMemZero(t, a);
                } else if (args == null || args[argNumber] === 0) {
                    zeroCount++;
                } else {
                    return -1;
                }
                argNumber++;
            }
        }
        return zeroCount;
    }

    private storeVariableFromWasmStack1(type: Type | PointerType, v: Variable, code: Array<wasm.Node>) {
        let s = this.storageOf(v);
        switch(s.storageType) {
            case "vars":
            case "params":
            case "result":
                code.push(new wasm.GetLocal(this.bpLocal));
                break;
            case "global_heap":
                let s = this.globalVarStorage.get(v);
                code.push(new wasm.Constant("i32", s.offset));
                break;
            case "local":
                if (this.varGCStorage.has(v)) {
                    // Some variables are stored in local variables AND on the heap stack where GC can find them
                    code.push(new wasm.GetLocal(this.bpLocal));
                }
                break;
            case "global_strings":
                throw "Implementation error";
        }
    }

    private storeVariableFromWasmStack2(type: Type | PointerType, v: Variable, tee: boolean, code: Array<wasm.Node>) {
        let width: wasm.StackType = this.stackTypeOf(type);
        let asWidth: null | "8"| "16" | "32" = null;
        switch (type) {
            case "i8":
            case "s8":
                asWidth = "8";
                break;
            case "i16":
            case "s16":
                asWidth = "16";
                break;
        }
        let s = this.storageOf(v);
        switch(s.storageType) {
            case "local":
                if (this.varGCStorage.has(v)) {
                    // Some variables are stored in local variables AND on the heap stack where GC can find them
                    let sAlternative = this.varGCStorage.get(v);
                    if (tee) {
                        code.push(new wasm.TeeLocal(s.offset));
                        code.push(new wasm.Store(width, asWidth, sAlternative.offset));                        
                        code.push(new wasm.GetLocal(s.offset));                        
                    } else {
                        code.push(new wasm.TeeLocal(s.offset));
                        code.push(new wasm.Store(width, asWidth, sAlternative.offset));                        
                    }
                } else {
                    if (tee) {
                        code.push(new wasm.TeeLocal(s.offset));
                    } else {
                        code.push(new wasm.SetLocal(s.offset));
                    }
                }
                break;
            case "global":
                if (tee) {
                    code.push(new wasm.TeeLocal(this.getTmpLocal(width)));
                }
                code.push(new wasm.SetGlobal(s.offset));
                if (tee) {
                    code.push(new wasm.GetLocal(this.getTmpLocal(width)));
                }
                break;                
            case "vars":
                if (tee) {
                    code.push(new wasm.TeeLocal(this.getTmpLocal(width)));
                }
                code.push(new wasm.Store(width, asWidth, this.varsFrame.fieldOffset(v.name)));
                if (tee) {
                    code.push(new wasm.GetLocal(this.getTmpLocal(width)));
                }
                break;                
            case "params":
                if (tee) {
                    code.push(new wasm.TeeLocal(this.getTmpLocal(width)));
                }
                code.push(new wasm.Store(width, asWidth, this.varsFrame.size + this.paramsFrame.fieldOffset(v.name)));
                if (tee) {
                    code.push(new wasm.GetLocal(this.getTmpLocal(width)));
                }
                break;                
            case "result":
                if (tee) {
                    code.push(new wasm.TeeLocal(this.getTmpLocal(width)));
                }
                code.push(new wasm.Store(width, asWidth, this.varsFrame.size + this.paramsFrame.size + this.resultFrame.fieldOffset(v.name)));
                if (tee) {
                    code.push(new wasm.GetLocal(this.getTmpLocal(width)));
                }
                break;     
            case "global_heap":
                if (tee) {
                    code.push(new wasm.TeeLocal(this.getTmpLocal(width)));
                }
                code.push(new wasm.Store(width, asWidth, 0));                
                if (tee) {
                    code.push(new wasm.GetLocal(this.getTmpLocal(width)));
                }
                break;        
            case "global_strings":
                throw "Implementation error";
        
        }
    }

    private asyncCallNumber(n: Node): number {
        return this.asyncCalls.indexOf(n);
    }

    private stepNumber(n: Node): number {
        return this.steps.indexOf(n);
    }

    private stepNumberFromName(name: string): number {
        return this.stepsByName.get(name);
    }

    private isBinaryInstruction(kind: NodeKind): boolean {
        switch(kind) {
            case "add":
            case "sub":
            case "mul":
            case "div":
            case "div_s":
            case "div_u":
            case "rem_s":
            case "rem_u":
            case "and":
            case "or":
            case "xor":
            case "shl":
            case "shr_u":
            case "shr_s":
            case "rotl":
            case "rotr":
            case "eq":
            case "ne":
            case "lt_s":
            case "lt_u":
            case "le_s":
            case "le_u":
            case "gt_s":
            case "gt_u":
            case "ge_s":
            case "ge_u":
            case "lt":
            case "gt":
            case "le":
            case "ge":
            case "min":
            case "max":
                return true;
        }
        return false;
    }

    private isUnaryInstruction(kind: NodeKind): boolean {
        switch(kind) {
            case "eqz":
            case "clz":
            case "ctz":
            case "popcnt":
            case "neg":
            case "abs":
            case "copysign":
            case "ceil":
            case "floor":
            case "trunc":
            case "nearest":
            case "sqrt":
                return true;
        }
        return false;
    }

    private stackTypeOf(t: Type | PointerType): wasm.StackType {
        if (t instanceof PointerType) {
            return "i32";
        }
        switch(t) {
            case "i64":
            case "s64":
                return "i64";
            case "f64":
                return "f64";
            case "f32":
                return "f32";
        }
        return "i32";
    }

    private allocLocal(type: Type | PointerType): number {
        let wtype = this.stackTypeOf(type);
        for(var entry of this.tmpLocalVariables.entries()) {
            let n = entry[0];
            let alloc = entry[1][0];
            let t = entry[1][1];
            if (!alloc && t == wtype) {
                this.tmpLocalVariables.set(n, [true, t]);
                return n;
            }
        }
        let n = this.wf.parameters.length + this.wf.locals.length;
        this.wf.locals.push(wtype);
        this.tmpLocalVariables.set(n, [true, wtype]);
        return n;
    }

    private freeLocal(n: number) {
        let t = this.tmpLocalVariables.get(n)[1];
        this.tmpLocalVariables.set(n, [false, t]);
    }

    private getTmpLocal(type: Type | "src" | "dest"): number {
        switch(type) {
            case "src":
                if (this.tmpI32SrcLocal == -1) {
                    this.tmpI32SrcLocal = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push("i32");
                }
                return this.tmpI32SrcLocal;
            case "dest":
                if (this.tmpI32DestLocal == -1) {
                    this.tmpI32DestLocal = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push("i32");
                }
                return this.tmpI32DestLocal;
            case "i32":
                if (this.tmpI32Local == -1) {
                    this.tmpI32Local = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpI32Local;
            case "i64":
                if (this.tmpI64Local == -1) {
                    this.tmpI64Local = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpI64Local;
            case "f32":
                if (this.tmpF32Local == -1) {
                    this.tmpF32Local = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpF32Local;
            case "f64":
                if (this.tmpF64Local == -1) {
                    this.tmpF64Local = this.wf.parameters.length + this.wf.locals.length;
                    this.wf.locals.push(type);
                }
                return this.tmpF64Local;
        }
        throw "Implementation error";
    }

    private storageOf(v: Variable): Wasm32Storage {
        if (this.varStorage.has(v)) {
            return this.varStorage.get(v);
        }
        return this.globalVarStorage.get(v);
    }

    private wfHasHeapFrame(): boolean {
        for(let s of this.varStorage.values()) {
            if (s.storageType == "result" || s.storageType == "vars" || s.storageType == "params") {
                return true;
            }
        }
        return false;
    }

    private encodeLiteral(type: Type | PointerType | StructType, data: BinaryData): Uint8Array {
        let buf = new BinaryBuffer();
        this.encodeLiteralIntern(type, data, 0, buf);
        return buf.data;
    }
    
    private encodeLiteralIntern(type: Type | PointerType | StructType, data: BinaryData, dataOffset: number, buf: BinaryBuffer): number {
        if (type instanceof StructType) {
            let pos = 0;
            for(let f of type.fields) {
                for(let i = 0; i < f[2]; i++) {
                    let fpos = type.fieldOffset(f[0]);
                    if (fpos > pos) {
                        buf.fill(fpos - pos);
                        pos = fpos;
                    }
                    dataOffset = this.encodeLiteralIntern(f[1], data, dataOffset, buf);
                    pos += sizeOf(f[1]);                    
                }
            }
        } else {
            switch (type) {
                case "i8":
                    buf.appendUint8(data[dataOffset++] as number);
                    break;
                case "s8":
                    buf.appendInt8(data[dataOffset++] as number);
                    break;
                case "i16":
                    buf.appendUint16(data[dataOffset++] as number);
                    break;
                case "s16":
                    buf.appendInt16(data[dataOffset++] as number);
                    break;
                case "i32":
                    buf.appendUint32(data[dataOffset++] as number);
                    break;
                case "s32":
                    buf.appendInt32(data[dataOffset++] as number);
                    break;         
                case "i64":
                    // TODO: 64 bit
                    buf.appendUint64(data[dataOffset++] as number);
                    break;
                case "s64":
                    // TODO: 64 bit
                    buf.appendInt64(data[dataOffset++] as number);
                    break;
                case "f32":
                    buf.appendFloat32(data[dataOffset++] as number);
                    break;
                case "f64":
                    buf.appendFloat32(data[dataOffset++] as number);
                    break;
                case "addr":
                case "ptr":
                    if (typeof(data[dataOffset]) == "string") {
                        let [offset, len] = this.module.addString(data[dataOffset++] as string);
                        buf.appendPointer(offset);
                    } else {
                        buf.appendPointer(data[dataOffset++] as number);
                    }
                    break;
                default:
                    throw "Implementation error";
            }
        }
        return dataOffset;
    }

    public module: wasm.Module;
    
    private tr: SMTransformer;
    private optimizer: Optimizer;
    private stackifier: Stackifier;
    private funcs: Array<{node: Node, wf: wasm.Function, isExported: boolean}>;
    private globalVariables: Array<Variable>;
    private globalVarStorage: Map<Variable, Wasm32Storage>;
    private copyFunctionIndex: string = "$copy";
    private allocFunctionIndex: string = "$alloc";
    private sliceAppendFunctionIndex: string = "$appendSlice";
    private garbageCollectFunctionIndex: string = "$garbageCollect";
    private growSliceFunctionIndex: string = "$growSlice";
    private makeStringFunctionIndex: string = "$makeString";
    private compareStringFunctionIndex: string = "$compareString";
    private concatStringFunctionIndex: string = "$concatString";
    private hashStringFunctionIndex: string = "$hashString";
    private createMapFunctionIndex: string = "$createMap";
    private setMapFunctionIndex: string = "$setMap";
    private lookupMapFunctionIndex: string = "$lookupMap";
    private removeMapKeyFunctionIndex: string = "$removeMapKey";
    private setNumericMapFunctionIndex: string = "$setNumericMap";
    private lookupNumericMapFunctionIndex: string = "$lookupNumericMap";
    private removeNumericMapKeyFunctionIndex: string = "$removeNumericMapKey";
    private decodeUtf8FunctionIndex: string = "$decodeUtf8";
    private scheduleCoroutineFunctionIndex: string = "$scheduleCoroutine";
    private currentCoroutineFunctionIndex: string = "$currentCoroutine";
    private createCoroutineFunctionIndex: string = "$createCoroutine";
    private stepLocal: number;
    private bpLocal: number;
    private spLocal: number;
    private asyncReturnLocal: number;
    private steps: Array<Node>;
    private stepCode: Array<Array<wasm.Node>>;
    private stepsByName: Map<string, number>;
    private asyncCalls: Array<Node>;
    private asyncCallCode: Array<Array<wasm.Node>>;
    private resultFrame: StructType;
    private paramsFrame: StructType;
    private varsFrame: StructType;
    private varsFrameHeader: StructType;
    /**
     * Stores for each variable in the current function where it is located.
     */
    private varStorage: Map<Variable, Wasm32Storage>;
    /**
     * Some variables have two storage locations. A fast one (local variable) and one on the stack frame
     * where the GC can find it.
     * 
     * Variables listed here are access in write-through. That means writes target the local variable and
     * the stack frame. Reading happens on the local variable only.
     */
    private varGCStorage: Map<Variable, Wasm32Storage>;
    /**
     * Some variables have two storage locations. A fast one (local variable) and one on the stack frame
     * where it survives the suspension of a coroutine.
     * 
     * Variables listed here are saved to the stack frame before the function returns.
     */
    private varAsyncStorage: Map<Variable, Wasm32Storage>;
    private varBinaryConstants: Map<Variable, number>;
    private parameterVariables: Array<Variable>;
    private localVariables: Array<Variable>;
    private returnVariables: Array<Variable>;
    private tmpLocalVariables: Map<number, [boolean, wasm.StackType]>;
    private tmpI32Local: number;
    private tmpI64Local: number;
    private tmpF32Local: number;
    private tmpF64Local: number;
    private tmpI32SrcLocal: number;
    private tmpI32DestLocal: number;
    private wf: wasm.Function;
    private wfIsAsync: boolean;
    private heapGlobalVariable: wasm.Global;
    private heapGlobalVariableIndex: number;
    private typemapGlobalVariable: wasm.Global;
    private typemapGlobalVariableIndex: number;
    private customglobalVariablesIndex: number;
    private heapSize: number = 16 << 16; // 1 MB heap
    private stackSize: number = 1 << 16; // 64kb Stack    
}

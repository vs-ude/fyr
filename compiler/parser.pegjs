{
    var ast = require("./ast");

    function isAssignment(n) {
        if (n.op == "=" || n.op == "let_in" || n.op == "*=" || n.op == "/=" || n.op == "/=" || n.op == "%=" || n.op == "&=" || n.op == "&^=" || n.op == "<<=" || n.op == ">>=" || n.op == "+=" || n.op == "-=" || n.op == "|=" || n.op == "^=" || n.op == ":=" || n.op == "var" || n.op == "let") {
            return true;
        }
        return false;
    }

    function isKeyword(n) {
        if (n == "make" || n == "println" || n == "default" || n == "switch" || n == "case" || n == "select" || n == "component" || n == "let" || n == "map" || n == "take" || n == "spawn" || n == "this" || n == "type" || n == "struct" || n == "extends" || n == "import" || n == "export" || n == "yield" || n == "true" || n == "false" || n == "null" || n == "in" || n == "func" || n == "is" || n == "for" || n == "if" || n == "else" || n == "struct" || n == "interface" || n == "var" || n == "const") {
            return true;
        }
        return false;
    }

    function fl(loc) {
        loc.file = ast.currentFile();
        return loc;
    }

    function runesToString(runes) {
        for(var i = 0, s = ''; i < runes.length; i++) {
            if (runes[i].op == "runeQ1") {
                s += "%22";
            } else if (runes[i].op == "runeQ2") {
                s += "%22%22";
            }
            s += String.fromCharCode(runes[i].numValue);
        }
        return s;
    }
}

file
  = m:(comments / func / import / export / build / typedef / varStatement / $("\n"+))* {
        let result = [];
        for(let i = 0; i < m.length; i++) {
            let x = m[i];
            if (x.op == "var" && x.lhs.op != "id") {
                error("Illegal variable definition for global variables", x.loc);
            }
            if (x.op == "func" || x.op == "export_func" || x.op == "typedef" || x.op == "var" || x.op == "let") {
                if (i > 0 && (m[i-1] instanceof Array)) {
                    x.comments = m[i-1];
                }
                result.push(x);
            } else if (x.op == "import" || x.op == "export_as" || x.op == "build") {
                result.push(x);
            }
        }
        return new ast.Node({loc: fl(location()), op: "file", statements: result});
    }

typedef
  = "type" [ \t]+ i:identifier g:(genericParameters / $([ \t]+)) t:type {
      return new ast.Node({loc: fl(location()), op: "typedef", name: i, rhs: t, genericParameters: g instanceof Array ? g : null});
    }

import
  = "import" [ \t]+ a:importSelect? [ \t]* m:(importNative / string) n:importAs? ([ \t]* newline)+ {
      if (m.op == "importNative") {
          if (!a || a.op == "identifierList") {
              expected("Either . or an identifier");
          }
      } else if (m.value == "") {
          expected("A non-empty string describing the import path");
      }
      return new ast.Node({loc: fl(location()), op: "import", rhs:m, lhs:a, name: n});
    }

importSelect
  = "." [ \t]+ "from" [ \t]+ {
        return new ast.Node({loc: fl(location()), op: "."});
    }
  / i:identifier [ \t]+ "from" [ \t]+ {
        return i;
    }
  / "{" [ \t]* i:identifierList [ \t]* "}" [ \t]* "from" [ \t]+ {
        return new ast.Node({loc: fl(location()), op: "identifierList", parameters: i});
    }

importNative
  = i:string [ \t]* "{" ([ \t]* newline)+ e:importElement* [ \t]* "}" {
        if (i == "") {
            expected("A non-empty string describing the imported namespace")
        }
        return new ast.Node({loc: fl(location()), op: "importNative", parameters: e, rhs:i})
    }

importElement
  = [ \t]* "func" [ \t]+ n:identifier [ \t]* "(" [ \t]* t:funcTypeParameters? [ \t]* ")" [ \t]* f:returnType? ([ \t]* newline)* {
      return new ast.Node({loc: fl(location()), op: "funcType", parameters: t ? t : [], rhs: f, name: n});
    }
  / [ \t]* t: typedef ([ \t]* newline)* {
      return t;
    }
  / [ \t]* "const" [ \t]+ i:identifier [ \t]* t:type ([ \t]* newline)* {
      return new ast.Node({loc: fl(location()), op: "constValue", lhs: t, name: i});
    }

importAs
  = [ \t]* "as" [ \t]* i:identifier {
      return i;
    }

export
  = "export" [ \t]* "{" ([ \t]* newline)+ e:exportAs* [ \t\n]* "}" {
      return new ast.Node({loc: fl(location()), op: "export_as", parameters: e});
  }

exportAs
  = [ \t]* "func" [ \t]+ n:identifier [ \t]* "as" [ \t]+ e:identifier [ \t]* ([ \t]* newline)* {
      return new ast.Node({loc: fl(location()), op: "exportFuncAs", lhs: n, rhs: e});
    }
  / [ \t]*"type" [ \t]+ n:identifier [ \t]* "as" [ \t]+ e:identifier [ \t]* ([ \t]* newline)* {
      return new ast.Node({loc: fl(location()), op: "exportTypeAs", lhs: n, rhs: e});
    }
  / [ \t]*"const" [ \t]+ n:identifier [ \t]* "as" [ \t]+ e:identifier [ \t]* ([ \t]* newline)* {
      return new ast.Node({loc: fl(location()), op: "exportConstAs", lhs: n, rhs: e});
    }
  / [ \t]*"var" [ \t]+ n:identifier [ \t]* "as" [ \t]+ e:identifier [ \t]* ([ \t]* newline)* {
      return new ast.Node({loc: fl(location()), op: "exportVarAs", lhs: n, rhs: e});
    }

build
  = "build" [ \t]* "{" ([ \t]* newline)+ e:buildElement* [ \t\n]* "}" {
      return new ast.Node({loc: fl(location()), op: "build", parameters: e});
  }

buildElement
  = [ \t]* "link" [ \t]* ":" [ \t]* "[" ([ \t]* newline)* v:buildElementValues? "]" ([ \t]* newline)* {
      return new ast.Node({loc: fl(location()), op: "build_link", parameters: v});
    }
  / [ \t]* "compile" [ \t]* ":" [ \t]* "[" ([ \t]* newline)* v:buildElementValues? "]" ([ \t]* newline)* {
      return new ast.Node({loc: fl(location()), op: "build_compile", parameters: v});
    }

buildElementValues
  = s:string ([ \t]* newline)* r:([ \t]* "," [ \t]* buildElementValues)? {
      let result = [s];
      if (r) {
          result = result.concat(r[3]);
      }
      return result;
  }

func
  = ex:("export" [ \t]+)? "func" [ \t]+ obj:((memberObjectType [ \t]* "." [ \t]* identifier) / identifier) [ \t]* g:genericParameters? "(" [ \t\n]* p:parameters? ")" [ \t]* t:returnType? [ \t]* b:block {
      if (p) {
          for(let i = 0; i < p.length; i++) {
              if (p[i].op == "ellipsisParam" && i != p.length - 1) {
                  error("'...' can only be attached to the last parameter", fl(location()));
              }
          }
      }
      let scope = undefined;
      let name = undefined;
      if (obj.op == "id") {
          name = obj;
      } else {
          scope = obj[0];
          name = obj[4];
      }
      let op = ex ? "export_func" : "func";
      return new ast.Node({loc: fl(location()), op: op, name: name, lhs: scope, parameters: p, statements: b, rhs: t, genericParameters: g});
    }

parameters
  = p:parameter r:([ \t]* "," [ \t\n]* parameter)* [ \t]* {
      if (r) {
        let result = [p];
        for(let x of r) {
          result.push(x[3]);
        }
        return result;
      }
      return [p];
    }

parameter
  = g:group? n:identifier [ \t]* t:type {
      t.name = n;
      t.groupName = g;
      return t;
    }
  / "..." [ \t]* g:group? n:identifier [ \t]* t:type {
      t.name = n;
      return new ast.Node({loc: fl(location()), op: "ellipsisParam", lhs: t});
    }

funcTypeParameters
  = g:group? (identifier [ \t]+)? p:type r:([ \t]* "," [ \t\n]* group? (identifier [ \t]+)? type)* [ \t]* {
      p.groupName = g;
      if (r) {
        let result = [p];
        for(let x of r) {
            let p2 = x[5];
            p2.groupName = x[3];
          result.push(p2);
        }
        return result;
      }
      return [p];
    }

group
  = "`" n:identifier [ \t]+ {
      return n
    }
  / "`" [ \t]+ {
      return new ast.Node({loc: fl(location()), op: "id", value: "default"});
  }

genericParameters
  = "<" [ \t]* t:genericTypeList ">" [ \t]* { return t; }

genericTypeList
  = t:identifier w:([ \t*] "is" [ \t*] type)? r:([ \t]* "," [ \t]* identifier ([ \t*] "is" [ \t*] type)?)* [ \t]* {
      if (w) {
          t.condition = w[3];
      }
      if (!r) {
          return [t];
      }
      let result = [t];
      for(let x of r) {
          if (x[4]) {
              x[3].condition = x[4][3];
          }
          result.push(x[3]);
      }
      return result;
    }

type
  = t:(andType / string) r:([ \t]* "|" [ \t]* (andType / string))* {
      if (!r || r.length == 0) {
          return t;
      }

      let result = [t];
      for(let x of r) {
          result.push(x[3]);
      }
      return new ast.Node({loc: fl(location()), op: "orType", parameters: result});
    }

andType
  = t:primitiveType r:([ \t]* "&" [ \t]* primitiveType)* {
      if (!r || r.length == 0) {
          return t;
      }
      let result = [t];
      for(let x of r) {
          result.push(x[3]);
      }
      return new ast.Node({loc: fl(location()), op: "andType", parameters: result})
    }

primitiveType
  = "[]" [ \t]* t:primitiveType {
      let a = new ast.Node({loc: fl(location()), op: "arrayType", rhs: t, lhs: null});
      return new ast.Node({loc: fl(location()), op: "sliceType", rhs: a, value: "[]"});
    }
  / "^[]" [ \t]* t:primitiveType {
      let a = new ast.Node({loc: fl(location()), op: "arrayType", rhs: t, lhs: null});
      return new ast.Node({loc: fl(location()), op: "sliceType", rhs: a, value: "^[]"});
    }
  / "~[]" [ \t]* t:primitiveType {
      let a = new ast.Node({loc: fl(location()), op: "arrayType", rhs: t, lhs: null});
      return new ast.Node({loc: fl(location()), op: "sliceType", rhs: a, value: "~[]"});
    }
  / "&[]" [ \t]* t:primitiveType {
      let a = new ast.Node({loc: fl(location()), op: "arrayType", rhs: t, lhs: null});
      return new ast.Node({loc: fl(location()), op: "sliceType", rhs: a, value: "&[]"});
    }
  / "[" [ \t]* e:expression? "]" [ \t]* t:primitiveType {
    return new ast.Node({loc: fl(location()), op: "arrayType", rhs: t, lhs: e})
    }
  / "map" [ \t]* "[" [ \t]* k:type [ \t]* "]" [ \t]* v:primitiveType {
        let m = new ast.Node({loc: fl(location()), op: "mapType", lhs: k, rhs: v});
        return new ast.Node({loc: fl(location()), op: "pointerType", rhs: m});
    }
  / "^map" [ \t]* "[" [ \t]* k:type [ \t]* "]" [ \t]* v:primitiveType {
        let m = new ast.Node({loc: fl(location()), op: "mapType", lhs: k, rhs: v});
        return new ast.Node({loc: fl(location()), op: "uniquePointerType", rhs: m});
    }
  / "~map" [ \t]* "[" [ \t]* k:type [ \t]* "]" [ \t]* v:primitiveType {
        let m = new ast.Node({loc: fl(location()), op: "mapType", lhs: k, rhs: v});
        return new ast.Node({loc: fl(location()), op: "referenceType", rhs: m});
    }
  / "&map" [ \t]* "[" [ \t]* k:type [ \t]* "]" [ \t]* v:primitiveType {
        let m = new ast.Node({loc: fl(location()), op: "mapType", lhs: k, rhs: v});
        return new ast.Node({loc: fl(location()), op: "localReferenceType", rhs: m});
    }
  / "(" [ \t]* t:typeList [ \t]* ")" {
      if (t.length == 1) {
          return t[0];
      }
      return new ast.Node({loc: fl(location()), op: "tupleType", parameters: t});
    }
  / "func" [ \t]* "(" [ \t]* t:funcTypeParameters? [ \t]* e:("," [ \t]* "..." [ \t]* type)? [ \t]* ")" [ \t]* f:returnType? {
      if (e) {
        t.push(new ast.Node({loc: e[4].loc, op: "ellipsisParam", lhs: e[4]}));
      }
      return new ast.Node({loc: fl(location()), op: "funcType", parameters: t ? t : [], rhs: f});
    }
  / "*" [ \t]* t:primitiveType {
      return new ast.Node({loc: fl(location()), op: "pointerType", rhs: t});
    }
  / "#" [ \t]* t:primitiveType {
      return new ast.Node({loc: fl(location()), op: "unsafePointerType", rhs: t});
    }
  / "~" [ \t]* t:primitiveType {
      return new ast.Node({loc: fl(location()), op: "referenceType", rhs: t});
    }
  / "&" [ \t]* t:primitiveType {
      return new ast.Node({loc: fl(location()), op: "localReferenceType", rhs: t});
    }
  / "^" [ \t]* t:primitiveType {
      return new ast.Node({loc: fl(location()), op: "uniquePointerType", rhs: t});
    }
  / "struct" [ \t]* "{" [ \t]* "\n" [ \t]* f:structFields? comments? [ \t]* "}" [ \t]* "\n" {
        return new ast.Node({loc: fl(location()), op: "structType", parameters: f ? f : []});
    }
  / "const" [ \t]+ t:primitiveType {
        return new ast.Node({loc: fl(location()), op: "constType", rhs: t})
    }
  / "interface" [ \t]* "{" [ \t]* f:interfaceContent? comments? "}" {
        return new ast.Node({loc: fl(location()), op: "interfaceType", parameters: f ? f : []});
    }
  / "null" {
      return new ast.Node({loc: fl(location()), op: "basicType", value: "null" });
    }
  / "copy" [ \t]* "<" t:type [ \t]* ">" {
      return new ast.Node({loc: fl(location()), op: "copyType", lhs: t});
    }
  / "opaque" {
      return new ast.Node({loc: fl(location()), op: "opaqueType"});
    }
  / i: identifier s:([ \t]* "." [ \t]* identifier)? g:([ \t]* "<" [ \t]* typeList [ \t]* ">" [ \t]*)? {
      let nspace = null;
      if (s) {
          nspace = i.value;
          i = s[3];
      }
      if (g) {
          return new ast.Node({loc: fl(location()), op: "genericType", genericParameters: g[3], lhs: i, nspace: nspace});
      }
      i.nspace = nspace;
      i.op = "basicType";
      return i;
    }

memberObjectType
  = "const" [ \t]+ r:("&" [ \t]*)? t:identifier {
        t.op = "basicType";
        if (r) {
            t.flags |= ast.AstFlags.ReferenceObjectMember;
        }
        return new ast.Node({loc: fl(location()), op: "constType", rhs: t})
    }
  /  r:("&" [ \t]*)? i: identifier {
      i.op = "basicType";
      if (r) {
        i.flags |= ast.AstFlags.ReferenceObjectMember;
      }
      return i;
    }

interfaceContent
  = "\n" [ \t]* m:interfaceMembers {
      return m;
    }

interfaceMembers
  = comments? [ \t]* i:interfaceMember m:interfaceMembers? {
      if (!m) {
          return [i];
      }
      return [i].concat(m);
  }

interfaceMember
  = "func" [ \t]* scope:ifaceObjectType? [ \t]* name:identifier [ \t]* "(" [ \t\n]* p:parameters? ")" [ \t]* t:returnType? [ \t]* semicolon {
      if (p) {
          for(let i = 0; i < p.length; i++) {
              if (p[i].op == "ellipsisParam" && i != p.length - 1) {
                  error("'...' can only be attached to the last parameter", fl(location()));
              }
          }
      }
      return new ast.Node({loc: fl(location()), op: "funcType", name: name, lhs: scope, parameters: p, rhs: t});
    }
  / "extends" [ \t]+ t:type [ \t]* semicolon {
        return new ast.Node({loc: fl(location()), op: "extends", rhs: t});
    }

ifaceObjectType
  = c:"const"? r:("&" [ \t]*)?  {
        let t = new ast.Node({loc: fl(location()), op: "structType", parameters: []});
        if (c) {
            t = new ast.Node({loc: fl(location()), op: "constType", rhs: t})
        }
        if (r) {
            t.flags |= ast.AstFlags.ReferenceObjectMember;
        }
        return t;
    }

namedType
  = n:identifier [ \t]* t:type {
      t.name = n;
      return t;
    }
  / t:type { return t; }

returnType
  = g:group? t:type {
      t.groupName = g;
      return t;
    }
  / "(" [ \t\n]* g:group? t:namedType r:([ \t]* "," [ \t\n]* group? namedType)* [ \t]* ")" {
      t.groupName = g;
      let result = [t];
      if (r) {
        for(let x of r) {
          let p = x[4];
          p.groupName = x[3];
          if (!!t.name != !!p.name) {
              error("mixing of named and unnamed return parameters", fl(location()));
          }
          result.push(p);
        }
      }
      return new ast.Node({loc: fl(location()), op: "tupleType", parameters: result});
    }

structFields
  = comments? [ \t]* i:structField m:structFields? {
      if (!m) {
          return [i];
      }
      return [i].concat(m);
  }

structField
  = "extends" [ \t]+ t:type [ \t]* semicolon {
      return new ast.Node({loc: fl(location()), op: "extends", rhs: t});
    }
  / "implements" [ \t]+ t:type [ \t]* semicolon {
      return new ast.Node({loc: fl(location()), op: "implements", rhs: t});
  }
  / i:identifier [ \t]+ t:type [ \t]* semicolon {
      return new ast.Node({loc: fl(location()), op: "structField", lhs: i, rhs: t});
  }

typeList
  = t:type r:([ \t]* "," [ \t]* type)* [ \t]* {
      if (!r) {
          return [t];
      }
      let result = [t];
      for(let x of r) {
          result.push(x[3]);
      }
      return result;
    }

block
  = "{" [ \t]* newline [ \t\n]* s:(statementOrComment)* "}" [ \t]* {
      return s;
  }

statementOrComment
  = c:comment [ \n\t]* { return c; }
  / s:statement [ \t]* c:semicolon { if (c) { s.comments = [c]; } return s; }

comments
  = c:([ \t]* comment)+ {
      if (c) {
        let result = [];
        for(let x of c) {
          result.push(x[1]);
        }
        return result;
      }
      return undefined;
    }

newline
  = "\n"
  / comment

comment
  = "//" c:$([^\n]*) "\n" { return new ast.Node({loc: fl(location()), op: "comment", value: c}); }

semicolon
  = ";" [ \n\t]* { return undefined; }
  / "\n" [ \n\t]* { return undefined; }
  / c:comment [ \n\t]* { return c; }

statement
  = "break" { return new ast.Node({loc: fl(location()), op: "break"}); }
  / "continue" { return new ast.Node({loc: fl(location()), op: "continue"}); }
  / "return" [ \t]* e:expressionList? {
      if (e && e.length == 1) {
          e = e[0];
      } else if (e) {
          e = new ast.Node({loc: fl(location()), op: "tuple", parameters: e});
      }
      return new ast.Node({loc: fl(location()), op: "return", lhs: e? e : undefined});
    }
  / "if" [ \t]* "(" [ \t\n]* init:simpleStatement e:([ \t]* ";" [ \t]* expression)? ")" [ \t]* b:block el:("else" [ \t\n]* elseBranch)? {
      if (e && (init.op != "var" && init.op != "let" && init.op != "=")) {
         expected("an assignment or variable definition", init.loc);
      }
      if (!e && isAssignment(init)) {
          expected("'an expression after the assignment", init.loc);
      }
      return new ast.Node({loc: fl(location()), op: "if", condition: e ? e[3] : init, lhs: e ? init : undefined, statements: b, elseBranch: el ? el[2] : undefined});
  }
  / "for" [ \t]* f:("(" [ \t\n]* forCondition ")" [ \t]* )? b:block {
      return new ast.Node({loc: fl(location()), op: "for", condition: f ? f[2] : undefined, statements:b});
    }
  / "yield" c:([ \t]+ "continue")? {
      if (c) {
          return new ast.Node({loc: fl(location()), op: "yield_continue"});
      }
      return new ast.Node({loc: fl(location()), op: "yield"});
    }
  / "spawn" [ \t]+ e:expression {
      if (e.op != "(") {
          expected("A function invocation following 'spawn'");
      }
      return new ast.Node({loc: fl(location()), op: "spawn", rhs: e});
    }
  / "copy" [ \t]* "(" [ \t]* e:expression [ \t]* "," [ \t]* e2:expression [ \t]* ")" {
      return new ast.Node({loc: fl(location()), op: "copy", lhs: e, rhs: e2});
    }
  / "move" [ \t]* "(" [ \t]* e:expression [ \t]* "," [ \t]* e2:expression [ \t]* ")" {
      return new ast.Node({loc: fl(location()), op: "move", lhs: e, rhs: e2});
    }
  / "slice" [ \t]* "(" [ \t]* e:expression [ \t]* "," [ \t]* e2:expression [ \t]* "," [ \t]* e3:expression [ \t]* ")" {
      return new ast.Node({loc: fl(location()), op: "slice", parameters: [e, e2, e3]});
    }
  / "push" [ \t]* "(" e:expressionListWithNewlines ")" {
      return new ast.Node({loc: fl(location()), op: "push", parameters: e});
    }
  / "append" [ \t]* "(" e: expressionListWithNewlines ")" {
      return new ast.Node({loc: fl(location()), op: "append", parameters: e});
    }

  / s: simpleStatement {
      if (s.op == "let_in") {
          error("'in' is allowed inside a for loop header only", s.loc);
      }
      return s;
    }

simpleStatement
  = v: varStatement { return v; }
  / i:assignIdentifierList [ \t]* p:("++" / "--" / (assignOp [ \t\n]* expression))? {
        if (!p) {
            if (i.length > 1) {
                expected("assignment operator", v.loc);
            }
            if (i[0].op == "ellipsisAssign") {
                error("'...' not allowed in this place", i[0].loc);
            } else if (i[0].op == "optionalAssign") {
                error("'?' not allowed in this place", i[0].loc);
            }
            return i[0];
        }
        if (p == "++") {
          if (i.length > 1) {
              error ("'++' not allowed in this place", p.loc);
          }
          return new ast.Node({loc: fl(location()), op: "++", lhs: i[0]});
        } else if (p == "--") {
          if (i.length > 1) {
              error ("'--' not allowed in this place", p.loc);
          }
          return new ast.Node({loc: fl(location()), op: "--", lhs: i[0]});
        }
        if (i.length > 1) {
            i = new ast.Node({loc: fl(location()), op: "tuple", parameters: i});
        } else {
            i = i[0];
        }
        return new ast.Node({loc: fl(location()), op: p[0], lhs: i, rhs: p[2]});
    }

assignIdentifierList
  = v:assignIdentifier [ \t]* r:("," [ \t\n]* assignIdentifier [ \t]*)* {
      if (r) {
        let result = [v];
        for(let x of r) {
          result.push(x[2]);
        }
        return result;
      }
      return [v];
    }

assignIdentifier
  = o:assignObject { return o; }
  / "[" [ \t\n]* e:assignIdentifierList "]" {
      return new ast.Node({loc: fl(location()), op: "array", parameters: e ? e : []});
    }
  / i:("_" / expression) [ \t]* o:"?"? {
      if (i == "_") {
          i = new ast.Node({loc: fl(location()), op: "id", value: "_"});
      }
      if (i.op == "unary..." && o) {
          error("'...' and '?' must not be used on the same expression", e.loc);
      } else if (i.op == "unary...") {
          return new ast.Node({loc: fl(location()), op: "ellipsisAssign", lhs: i.rhs});
      } else if (o) {
          return new ast.Node({loc: fl(location()), op: "optionalAssign", lhs: i});
      }
      return i;
  }

assignObject
  = "{" [ \t\n]* e:assignKeyIdentifierList? [ \t]* "}" {
      return new ast.Node({loc: fl(location()), op: "object", parameters: e});
    }

assignKeyIdentifierList
  = kv:assignKeyIdentifier r:([ \t]* "," [ \t\n]* assignKeyIdentifier)* {
      let result = [kv];
      if (r) {
        for(let x of r) {
          result.push(x[3]);
        }
      }
      return result;
    }

assignKeyIdentifier
  = i:identifier [ \t]* o:("?")? [ \t]* ":" [ \t]* e:assignIdentifier {
      if (e.op == "ellipsisAssign") {
          error("'...' must not be used in this place", e.loc);
      } else if (e.op == "optionalAssign") {
          error("'?' must not be used in this place", e.loc);
      }
      let kv = new ast.Node({loc: fl(location()), op: "keyValue", name: i, lhs: e});
      if (o) {
          kv.op = "optionalKeyValue";
      }
      return kv;
    }
  / "..." [ \t]* e:expression {
      return new ast.Node({loc: fl(location()), op: "ellipsisAssign", lhs: e});
    }

varStatement
  = o:("var" / "let") [ \t]+ i:varIdentifierList a:(("=" / "in" [ \t]+) [ \t\n]* expression)? {
        if (i.length > 1) {
            i = new ast.Node({loc: fl(location()), op: "tuple", parameters: i});
        } else {
            i = i[0];
        }
        if (!a) {
            if (o == "let") {
                expected("assignment following 'let'", o.loc);
            }
            return new ast.Node({loc: fl(location()), op: "var", lhs: i});
        }

        if (a[0].length == 2 && a[0][0] == "in") {
            if (i.op == "array" || i.op == "object") {
                error("array or object not allowed in this context", i.loc)
            }
            if (i.op == "tuple") {
                if (i.parameters.length > 2) {
                    error("too many identifiers left of 'in'", i.parameters[2].loc);
                }
                if (i.parameters[0].op != "id") {
                    error("expression is not allowed on left-hand side of an assignment when used together with 'in'", i.parameters[0].loc);
                }
                if (i.parameters[1].op != "id") {
                    error("expression is not allowed on left-hand side of an assignment when used together with 'in'", i.parameter[1].loc);
                }
            } else if (i.op != "id") {
                error("expression is not allowed on left-hand side of an assignment when used together with 'in'", i.loc);
            }
            if (o == "var") {
                error("'var' is not allowed in this place. Use 'let' instead.", fl(location));
            }
            return new ast.Node({loc: fl(location()), op: "let_in" ,lhs: i, rhs: a[2]});
        }

        return new ast.Node({loc: fl(location()), op: o, lhs: i, rhs: a[2]});
    }

varIdentifierList
  = v:varIdentifier [ \t]* r:("," [ \t\n]* varIdentifier [ \t]*)* {
      if (r) {
        let result = [v];
        for(let x of r) {
          result.push(x[2]);
        }
        return result;
      }
      return [v];
    }

varIdentifier
  = "(" [ \t\n]* e:varIdentifierList ")" {
      return new ast.Node({loc: fl(location()), op: "tuple", parameters: e});
    }
  / o:varObject { return o; }
  / "[" [ \t\n]* e:varIdentifierList "]" {
      return new ast.Node({loc: fl(location()), op: "array", parameters: e ? e : []});
    }
  / e:"..."? [ \t]* i:("_" / identifier) [ \t]* o:"?"? [ \t]* t:type? {
      if (i == "_") {
          if (t) {
              error("The placeholder '_' must not have a type", t.loc);
          }
          i = new ast.Node({loc: fl(location()), op: "id", value: "_"});
      }
      if (t) {
          i.rhs = t;
      }
      if (e) {
          i.op = "ellipsisId";
      } else if (o) {
          i.op = "optionalId";
      } else if (e && o) {
          error("'...' and '?' must not be used on the same identifier", e.loc);
      }
      return i;
  }

varObject
  = "{" [ \t\n]* e:varKeyIdentifierList? [ \t]* "}" {
      return new ast.Node({loc: fl(location()), op: "object", parameters: e});
    }

varKeyIdentifierList
  = kv:varKeyIdentifier r:([ \t]* "," [ \t\n]* varKeyIdentifier)* {
      let result = [kv];
      if (r) {
        for(let x of r) {
          result.push(x[3]);
        }
      }
      return result;
    }

varKeyIdentifier
  = i:identifier [ \t]* o:("?")? [ \t]* ":" [ \t]* e:varIdentifier {
      if (e.op == "ellipsisId") {
          error("... must not be used in this place", e.loc);
      } else if (e.op == "optionalId") {
          error("'?' must not be used in this place", e.loc);
      }
      let kv = new ast.Node({loc: fl(location()), op: "keyValue", name: i, lhs: e});
      if (o) {
          kv.op = "optionalKeyValue";
      }
      return kv;
    }
  / "..." i:identifier [ \t]* t:type? {
      if (t) {
          i.rhs = t;
      }
      i.op = "ellipsisId";
      return i;
    }

assignOp
  = "="
  / "*="
  / "/="
  / "%="
  / "&="
  / "&^="
  / "<<="
  / ">>="
  / "+="
  / "-="
  / "|="
  / "^="

forCondition
  = left: simpleStatement r:([ \t]* ";" [ \t]* expression? [ \t]* ";" [ \t]* simpleStatement?)? {
      if (r) {
          return new ast.Node({loc: fl(location()), op: ";;", lhs: left, condition: r[3], rhs: r[7]});
      }
      if (isAssignment(left) && left.op != "let_in") {
          console.log(left.op);
        error("assignment is not allowed in the condition branch of a 'for' loop", left.loc);
      }
      return left;
    }
  / ";" [ \t]* e:expression? [ \t]* ";" [ \t]* s:simpleStatement? {
        return new ast.Node({loc: fl(location()), op: ";;", condition: e, rhs: s});
    }

elseBranch
  = "if" [ \t]* "(" [ \t\n]* init:simpleStatement e:([ \t]* ";" [ \t]* expression)? ")" [ \t]* b:block el:("else" [ \t\n]* elseBranch)? {
      if (e && (init.op != "var" && init.op != "=")) {
         expected("an assignment or variable definition ", init.loc);
      }
      if (!e && isAssignment(init)) {
          expected("'an expression after the assignment", init.loc);
      }
      return new ast.Node({loc: fl(location()), op: "if", condition: e ? e[3] : init, lhs: e ? init : undefined, statements: b, elseBranch: el ? el[2] : undefined});
    }
  / b: block { return new ast.Node({loc: fl(location()), op: "else", statements: b}); }

expression
  = c: logicOr { return c; }

expressionList
  = e:expression [ \t]* r:("," (newline / [ \t])* expression [ \t]*)* {
      if (r) {
        let result = [e];
        for(let x of r) {
          result.push(x[2]);
        }
        return result;
      }
      return [e];
    }

expressionListWithNewlines
  = (newline / [ \t])* e:expressionList? (newline / [ \t])* {
      if (e) {
        return e;
      }
      return [];
  }

logicOr
  = left: logicAnd r:([ \t]* "||" [ \t\n]* logicOr)? {
      if (r) {
         return new ast.Node({loc: fl(location()), op: "||", lhs: left, rhs: r[3]});
      }
      return left;
  }

logicAnd
  = left: comparison r:([ \t]* "&&" [ \t\n]* logicAnd)? {
      if (r) {
         return new ast.Node({loc: fl(location()), op: "&&", lhs: left, rhs: r[3]});
      }
      return left;
  }

comparison
  = left:dynamicTypeCast right:([ \t]* comparison2)? {
      if (right) {
          right[1].lhs = left;
          return right[1];
      }
      return left;
    }

comparison2
  = "==" [ \t\n]* right:dynamicTypeCast { return new ast.Node({loc: fl(location()), op: "==", rhs:right}); }
  / "!=" [ \t\n]* right:dynamicTypeCast { return new ast.Node({loc: fl(location()), op: "!=", rhs:right}); }
  / "<=" [ \t\n]* right:dynamicTypeCast { return new ast.Node({loc: fl(location()), op: "<=", rhs:right}); }
  / ">=" [ \t\n]* right:dynamicTypeCast { return new ast.Node({loc: fl(location()), op: ">=", rhs:right}); }
  / ">" [ \t\n]* right:dynamicTypeCast { return new ast.Node({loc: fl(location()), op: ">", rhs:right}); }
  / "<" [ \t\n]* right:dynamicTypeCast { return new ast.Node({loc: fl(location()), op: "<", rhs:right}); }

dynamicTypeCast
  = a:additive c:([ \t]+ "is" [ \t]+ type)? {
      if (!c) {
          return a
      }
      return new ast.Node({loc: fl(location()), op: "is", lhs: a, rhs: c[3]});
  }

additive
  = left:multiplicative right:([ \t]* additive2)* {
      if (right) {
          var result = left;
          for(var i = 0; i < right.length; i++) {
              right[i][1].lhs = result
              result = right[i][1];
          }
          return result;
      }
      return left;
    }

additive2
  = "+" ![=+] [ \t\n]* right:multiplicative { return new ast.Node({loc: fl(location()), op: "+", rhs:right}); }
  / "-" ![=-] [ \t\n]* right:multiplicative { return new ast.Node({loc: fl(location()), op: "-", rhs:right}); }
  / "|" ![|=] [ \t\n]* right:multiplicative { return new ast.Node({loc: fl(location()), op: "|", rhs:right}); }
  / "^" [ \t\n]* right:multiplicative { return new ast.Node({loc: fl(location()), op: "^", rhs:right}); }

multiplicative
  = left:unary right:([ \t]* multiplicative2)* {
      if (right) {
          var result = left;
          for(var i = 0; i < right.length; i++) {
              right[i][1].lhs = result
              result = right[i][1];
          }
          return result;
      }
      return left;
    }

multiplicative2
  = "*" !"=" [ \t\n]* right:unary { return new ast.Node({loc: fl(location()), op: "*", rhs:right}); }
  / "/" !"=" [ \t\n]* right:unary { return new ast.Node({loc: fl(location()), op: "/", rhs:right}); }
  / "%" !"=" [ \t\n]* right:unary { return new ast.Node({loc: fl(location()), op: "%", rhs:right}); }
  / "&^" !"=" [ \t\n]* right:unary { return new ast.Node({loc: fl(location()), op: "&^", rhs:right}); }
  / "<<" !"=" [ \t\n]* right:unary { return new ast.Node({loc: fl(location()), op: "<<", rhs:right}); }
  / ">>" !"=" [ \t\n]* right:unary { return new ast.Node({loc: fl(location()), op: ">>", rhs:right}); }
  / "&" ![=&] [ \t\n]* right:unary { return new ast.Node({loc: fl(location()), op: "&", rhs:right}); }

unary
  = "+" [ \t\n]* p:unary { return new ast.Node({loc: fl(location()), op: "unary+", rhs:p}); }
  / "-" [ \t\n]* p:unary { return new ast.Node({loc: fl(location()), op: "unary-", rhs:p}); }
  / "!" [ \t\n]* p:unary { return new ast.Node({loc: fl(location()), op: "unary!", rhs:p}); }
  / "^" [ \t\n]* p:unary { return new ast.Node({loc: fl(location()), op: "unary^", rhs:p}); }
  / "*" [ \t\n]* p:unary { return new ast.Node({loc: fl(location()), op: "unary*", rhs:p}); }
  / "&" [ \t\n]* p:unary { return new ast.Node({loc: fl(location()), op: "unary&", rhs:p}); }
  / "..." [ \t\n]* p:unary { return new ast.Node({loc: fl(location()), op: "unary...", rhs:p}); }
  / p: primary { return p; }

typedLiteral
  = "[]" [ \t]* t:type [ \t]* l: array {
      let a = new ast.Node({loc: fl(location()), op: "arrayType", rhs: t, lhs: null});
      l.lhs = new ast.Node({loc: fl(location()), op: "sliceType", rhs: a, value: "[]"});
      return l;
    }
  / "^[]" [ \t]* t:type [ \t]* l: array {
      let a = new ast.Node({loc: fl(location()), op: "arrayType", rhs: t, lhs: null});
      l.lhs = new ast.Node({loc: fl(location()), op: "sliceType", rhs: a, value: "^[]"});
      return l;
    }
  / "~[]" [ \t]* t:type [ \t]* l: array {
      let a = new ast.Node({loc: fl(location()), op: "arrayType", rhs: t, lhs: null});
      l.lhs = new ast.Node({loc: fl(location()), op: "sliceType", rhs: a, value: "~[]"});
      return l;
    }
  / "[" [ \t]* e:expression? "]" [ \t]* t:type [ \t]* l: array {
      l.lhs = new ast.Node({loc: fl(location()), op: "arrayType", rhs: t, lhs: e});
      return l;
    }
  / "(" [ \t]* t:typeList & {return t.length > 1;} [ \t]* ")" [ \t]* l: tuple {
      l.lhs = new ast.Node({loc: fl(location()), op: "tupleType", parameters: t});
      return l;
    }
  / "struct" [ \t]* e:("extends" [ \t]+ type [ \t]*)? "{" [ \t]* "\n" [ \t]* f:structField* [ \t]* "}" [ \t]* l: object {
        let ext = e ? e[2] : null;
        l.lhs = new ast.Node({loc: fl(location()), op: "structType", parameters: f, lhs: ext});
        return l;
    }
  / i :identifier l:object {
      i.op = "basicType";
      l.lhs = i;
      return l;
  }

typeCast
  = "<" [ \t]* t:type [ \t]* ">" [ \t]* e: unary {
        if (e.op == "array" || e.op == "tuple" || e.op == "object") {
            e.lhs = t;
            return e;
        }
        return new ast.Node({loc: fl(location()), op: "typeCast", lhs: t, rhs: e});
    }

primary
  = [ \t\n]* p:primary2 m:([ \t]* member)* {
        if (!m) {
            return p;
        }
        let left = p;
        for(let x of m) {
            x[1].lhs = left;
            left = x[1];
        }
        return left;
    }

primary2
  = "tryPush" [ \t]* "(" e: expressionListWithNewlines ")" {
      return new ast.Node({loc: fl(location()), op: "tryPush", parameters: e});
    }
  / "pop" [ \t]* "(" [ \t\n]* e: expression ")" {
      return new ast.Node({loc: fl(location()), op: "pop", lhs: e});
    }
  / t: typedLiteral { return t; }
  / c: typeCast { return c; }
  / n: number { return n; }
  / s: string { return s; }
  / "true" { return new ast.Node({loc: fl(location()), op: "bool", value: "true"}); }
  / "false" { return new ast.Node({loc: fl(location()), op: "bool", value: "false"}); }
  / "null" { return new ast.Node({loc: fl(location()), op: "null"}); }
  / "this" { return new ast.Node({loc: fl(location()), op: "id", value: "this"}); }
  / "take" [ \t]* "(" [ \t]* e:expression [ \t]* ")" {
      return new ast.Node({loc: fl(location()), op: "take", lhs: e});
    }
  / "len" [ \t]* "(" [ \t]* e:expression [ \t]* ")" {
      return new ast.Node({loc: fl(location()), op: "len", lhs: e});
    }
  / "cap" [ \t]* "(" [ \t]* e:expression [ \t]* ")" {
      return new ast.Node({loc: fl(location()), op: "cap", lhs: e});
    }
  / "clone" [ \t]* "(" [ \t]* e:expression [ \t]* ")" {
      return new ast.Node({loc: fl(location()), op: "clone", lhs: e});
    }
  / "sizeOf" [ \t]* "<" [ \t]* t:type [ \t]* ">" {
      return new ast.Node({loc: fl(location()), op: "sizeof", lhs: t});
    }
  / "alignedSizeOf" [ \t]* "<" [ \t]* t:type [ \t]* ">" {
      return new ast.Node({loc: fl(location()), op: "aligned_sizeof", lhs: t});
    }
  / "max" [ \t]* "<" [ \t]* t:type [ \t]* ">" {
      return new ast.Node({loc: fl(location()), op: "max", lhs: t});
    }
  / "min" [ \t]* "<" [ \t]* t:type [ \t]* ">" {
      return new ast.Node({loc: fl(location()), op: "min", lhs: t});
    }
  / "make" [ \t]* "<" [ \t]* t:type [ \t]* ">" [ \t]* "(" [ \t]* s:expressionListWithNewlines? [ \t]* ")" {
      return new ast.Node({loc: fl(location()), op: "make", lhs: t, parameters: s ? s : []});
    }
  / i: identifier {
      return i;
    }
  / "(" e: expressionListWithNewlines ")" {
      if (e.length == 1) {
          return e[0];
      }
      return new ast.Node({loc: fl(location()), op: "tuple", parameters: e});
    }
  / "func" [ \t]* "(" [ \t]* p:parameters? ")" [ \t]* t:type? [ \t]* b:(block / ("=>" [ \t]* expression)) {
      if (b.length > 1 && b[0] == "=>") {
          return new ast.Node({loc: fl(location()), op: "=>", parameters: p, lhs: t, rhs: b[2]});
      }
      if (!t) {
          expected("return type in lambda expression", fl(location()));
      }
      return new ast.Node({loc: fl(location()), op: "=>", parameters: p, lhs: t, statements: b});
    }
  / o:object { return o; }
  / a:array { return a; }
  / r:rune { return r; }
  / "println" [ \t]* "(" a:expressionListWithNewlines ")" {
      return new ast.Node({loc: fl(location()), op: "println", parameters: a});
    }
  / "component" [ \t]* "." [ \t]* e:componentElement {
      return e;
  }

componentElement
  = "resume" [ \t]* "(" [ \t\n]* e: expression ")" {
      return new ast.Node({loc: fl(location()), op: "resume", lhs: e});
    }
  / "coroutine" [ \t]* "(" [ \t\n]* ")" {
      return new ast.Node({loc: fl(location()), op: "coroutine"});
    }

array
  = "[" [ \t\n]* e:arrayElementList? [ \t\n]* "]" {
      return new ast.Node({loc: fl(location()), op: "array", parameters: e ? e : []});
    }

arrayElementList
  = e:expressionList z:([ \t\n]* "," [ \t\n]* "...")? {
      if (z) {
          e.push(new ast.Node({loc: fl(location()), op: "..."}));
      }
      return e;
    }
  / "..." {
      return [new ast.Node({loc: fl(location()), op: "..."})];
    }

object
  = "{" [ \t\n]* e:keyValueList? [ \t]* "}" {
      return new ast.Node({loc: fl(location()), op: "object", parameters: e});
    }

tuple
  = "(" e: expressionListWithNewlines ")" & {
      return e.length > 1
    } {
        return new ast.Node({loc: fl(location()), op: "tuple", parameters: e});
    }

keyValueList
  = kv:keyValue r:([ \t]* "," [ \t\n]* keyValue)* {
      let result = [kv];
      if (r) {
        for(let x of r) {
          result.push(x[3]);
        }
      }
      return result;
    }

keyValue
  = i:identifier [ \t]* ":" [ \t]* e:expression {
      return new ast.Node({loc: fl(location()), op: "keyValue", name: i, lhs: e});
    }
  / "..." i:identifier {
      i.op = "ellipsisId";
      return i;
    }

number "number"
  = digits:$([0-9]* "." [0-9]+) { return new ast.Node({loc: fl(location()), op: "float", value: digits}); }
  / "0x" digits:$([0-9a-f]+) { return new ast.Node({loc: fl(location()), op: "int", value: "0x" + digits}); }
  / digits:$([0-9]+) { return new ast.Node({loc: fl(location()), op: "int", value: digits}); }

member
  = "." [ \t\n]* i:identifier { return new ast.Node({loc: fl(location()), op: ".", name:i}); }
  / "[" [ \t\n]* e:expression? r:(":" expression?)? "]" {
      if (!e && !r) {
          expected("an index or range expression between brackets", fl(location()));
      }
      if (r) {
          return new ast.Node({loc: fl(location()), "op":":", parameters: [e, r[1]]});
      }
      return new ast.Node({loc: fl(location()), op: "[", rhs: e});
    }
  / "(" a:expressionListWithNewlines ")" { return new ast.Node({loc: fl(location()), op: "(", parameters: a}); }
  / "<" [ \t]* t:typeList [ \t]* ">" { return new ast.Node({loc: fl(location()), op: "genericInstance", genericParameters: t}); }

identifierList
  = v:identifier [ \t]* r:("," [ \t\n]* identifier [ \t]*)* {
      if (r) {
        let result = [v];
        for(let x of r) {
          result.push(x[2]);
        }
        return result;
      }
      return [v];
  }

identifier "identifier"
  = i:$([a-zA-Z][a-zA-Z_0-9]*) & {
      return !isKeyword(i);
    } {
      return new ast.Node({loc: fl(location()), op: "id", value: i});
    }

string "string"
  = "\"\"\"" s:multilinechar* "\"\"\"" {
      return new ast.Node({loc: fl(location()), op: "str", value: runesToString(s)});
    }
  / '"' s:stringchar* '"' { return new ast.Node({loc: fl(location()), op: "str", value: runesToString(s)}); }

stringchar
  = r: runecharSpecial { return r; }
  / s:$([^"]) {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: s.charCodeAt(0)});
    }

multilinechar
  = '"' '"' s:stringchar {
      s.op = "runeQ2";
      return s;
    }
  / '"' s:stringchar {
      s.op = "runeQ1";
      return s;
    }
  / s:stringchar {
      return s;
    }

rune
  = "'" c:runechar "'" {
    return c;
  }

runechar
  = r: runecharSpecial { return r; }
  / s:$([^']) {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: s.charCodeAt(0)});
    }

runecharSpecial
  = s:"\\a" {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: 7});
    }
  / s:"\\b" {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: 8});
    }
  / s:"\\f" {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: 12});
    }
  / s:"\\n" {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: 10});
    }
  / s:"\\r" {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: 13});
    }
  / s:"\\t" {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: 9});
    }
  / s:"\\v" {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: 11});
    }
  / s:"\\\\" {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: 0x5c});
    }
  / s:"\\'" {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: 0x27});
    }
  / s:"\\\"" {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: 0x22});
    }
  / s:$("\\x" [0-9a-f] [0-9a-f]) {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: parseInt(s.substr(2), 16)});
    }
  / s:$("\\u" [0-9a-f] [0-9a-f] [0-9a-f] [0-9a-f]) {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: parseInt(s.substr(2), 16)});
    }
  / s:$("\\U" [0-9a-f] [0-9a-f] [0-9a-f] [0-9a-f] [0-9a-f] [0-9a-f] [0-9a-f] [0-9a-f]) {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: parseInt(s.substr(2), 16)});
    }
  / s:$("\\" [0-7] [0-7] [0-7]) {
      return new ast.Node({loc: fl(location()), op: "rune", value: s, numValue: parseInt(s.substr(2), 8)});
    }

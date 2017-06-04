{
    var ast = require("./ast");

    function isAssignment(n) {
        if (n.op == "=" || n.op == "var_in" || n.op == "const_in" || n.op == "in" || n.op == "*=" || n.op == "/=" || n.op == "/=" || n.op == "%=" || n.op == "&=" || n.op == "&^=" || n.op == "<<=" || n.op == ">>=" || n.op == "+=" || n.op == "-=" || n.op == "|=" || n.op == "^=" || n.op == ":=" || n.op == "var" || n.op == "const") {
            return true;
        }
        return false;
    }

    function isKeyword(n) {
        if (n == "type" | n == "struct" | n == "extends" || n == "import" || n == "export" || n == "yield" || n == "true" || n == "false" || n == "null" || n == "as" || n == "in" || n == "func" || n == "is" || n == "for" || n == "if" || n == "else" || n == "class" || n == "struct" || n == "interface" || n == "enum" || n == "readonly" || n == "virtual" || n == "get" || n == "set") {
            return true;
        }
        return false;
    }
}

module
  = m:(comments / func / import / typedef / $("\n"+))* {
        let result = [];
        for(let i = 0; i < m.length; i++) {
            let x = m[i];
            if (x.op == "func") {
                if (i > 0 && (m[i-1] instanceof Array)) {
                    x.comments = m[i-1];
                }
                result.push(x);
            } else if (x.op == "import" || x.op == "typedef") {
                result.push(x);                
            }
        }
        return new ast.Node({loc: location(), op: "module", statements: result});
    }

typedef
  = "type" [ \t]+ i:identifier [ \t]+ t:type {
      return new ast.Node({loc: location(), op: "typedef", name: i, rhs: t});
    }

import
  = "import" [ \t]* "{" [ \t]* "\n" [ \t]* e:importElement* [ \t]* "}" [ \t]* "from" [ \t]+ m:string [ \t]* "\n" [ \t]* {
      return new ast.Node({loc: location(), op: "import", parameters:e, rhs:m});
    }

importElement
  = "func" [ \t]* n:identifier [ \t]* "(" [ \t]* t:funcTypeParameters [ \t]* ")" [ \t]* f:type? [ \t]* "\n" [ \t]* {
      return new ast.Node({loc: location(), op: "funcType", parameters: t, rhs: f, name: n});
    }

func
  = "func" [ \t]* n:identifier? [ \t]* g:genericParameters? "(" [ \t\n]* p:parameters? ")" [ \t]* t:returnType? [ \t]* b:block {
      if (p) {
          for(let i = 0; i < p.length; i++) {
              if (p[i].op == "ellipsisParam" && i != p.length - 1) {
                  error("'...' can only be attached to the last parameter");
              }
          }
      }
      return new ast.Node({loc: location(), op: "func", name: n?n:undefined, parameters: p, statements: b, rhs: t, genericParameters: g});
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
  = n:identifier [ \t]* t:type {
      t.name = n;
      return t;
    }
  / "..." [ \t]* n:identifier [ \t]* t:type {
      t.name = n;
      return new ast.Node({loc: location(), op: "ellipsisParam", lhs: t});
    }

funcTypeParameters
  = p:type r:([ \t]* "," [ \t\n]* type)* [ \t]* {
      if (r) {
        let result = [p];
        for(let x of r) {
          result.push(x[3]);
        }
        return result;
      }
      return [p];
    }

genericParameters
  = "<" [ \t]* t:genericTypeList ">" [ \t]* { return t; }

genericTypeList
  = t:type w:([ \t*] "is" [ \t*] type)? r:([ \t]* "," [ \t]* type ([ \t*] "is" [ \t*] type)?)* [ \t]* {
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
      if (t.op == "str") {
          t.op = "strType";
      }
      if (!r || r.length == 0) {
          return t;
      }
      let result = [t];
      for(let x of r) {
          if (x[3].op == "str") {
              x[3].op = "strType";
          }
          result.push(x[3]);
      }
      return new ast.Node({loc: location(), op: "orType", parameters: result})
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
      return new ast.Node({loc: location(), op: "andType", parameters: result})
    }

primitiveType
  = "[" [ \t]* e:expression? "]" [ \t]* t:type {
      if (e) {
          return new ast.Node({loc: location(), op: "arrayType", rhs: t, lhs: e})
      }
      return new ast.Node({loc: location(), op: "sliceType", rhs: t})
    }
  / "(" [ \t]* t:typeList [ \t]* ")" {
      return new ast.Node({loc: location(), op: "tupleType", parameters: t});
    }
  / "func" [ \t]* "(" [ \t]* t:funcTypeParameters [ \t]* e:("," [ \t]* "..." [ \t]* type)? [ \t]* ")" [ \t]* f:type? {
      if (e) {
        t.push(new ast.Node({loc: e[4].loc, op: "ellipsisParam", lhs: e[4]}));
      }
      return new ast.Node({loc: location(), op: "funcType", parameters: t, rhs: f});      
    }
  / "*" [ \t]* t:primitiveType {
      return new ast.Node({loc: location(), op: "pointerType", rhs: t});
    }
  / "#" [ \t]* t:primitiveType {
      return new ast.Node({loc: location(), op: "unsafePointerType", rhs: t});
    }
  / "@" [ \t]* t:primitiveType {
      return new ast.Node({loc: location(), op: "guardedPointerType", rhs: t});
    }
  / i: identifier g:([ \t]* "<" [ \t]* typeList [ \t]* ">" [ \t]*)? {
      if (g) {
          return new ast.Node({loc: location(), op: "genericType", genericParameters: g[3], lhs: i});
      } 
      i.op = "basicType";
      return i;
    }
  / "struct" [ \t]* e:("extends" [ \t]+ type [ \t]*)? "{" [ \t]* "\n" [ \t]* f:structField* [ \t]* "}" [ \t]* "\n" {
        let ext = e ? e[2] : null;
        return new ast.Node({loc: location(), op: "structType", parameters: f, lhs: ext})
    }

namedType
  = n:identifier [ \t]* t:type {
      t.name = n;
      return t;
    }
  / t:type { return t; }

returnType
  = t:type { return t; }
  / "(" [ \t\n]* t:namedType r:([ \t]* "," [ \t\n]* namedType)* [ \t]* ")" {
      let result = [t];
      if (r) {
        for(let x of r) {
          if (!!t.name != !!x[3].name) {
              error("mixing of named and unnamed return parameters");
          }
          result.push(x[3]);
        }
      }
      return new ast.Node({loc: location(), op: "tupleType", parameters: result});
    }

structField
  = [ \t]* i:identifier [ \t]+ t:type [ \t]* semicolon {
      return new ast.Node({loc: location(), op: "structField", lhs: i, rhs: t});
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
  / s:statement c:semicolon { if (c) { s.comments = [c]; } return s; } 

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
  = "//" c:$([^\n]*) "\n" { return new ast.Node({loc: location(), op: "comment", value: c}); }

semicolon
  = ";" [ \n\t]* { return undefined; }
  / "\n" [ \n\t]* { return undefined; }
  / c:comment [ \n\t]* { return c; }

statement
  = "break" { return new ast.Node({loc: location(), op: "break"}); }
  / "continue" { return new ast.Node({loc: location(), op: "continue"}); }
  / "return" [ \t]* e:expressionList? {
      if (e && e.length == 1) {
          e = e[0];
      } else if (e) {
          e = new ast.Node({loc: location(), op: "tuple", parameters: e});
      }
      return new ast.Node({loc: location(), op: "return", lhs: e? e : undefined});
    }
  / "if" [ \t]* "(" [ \t\n]* init:simpleStatement e:([ \t]* ";" [ \t]* expression)? ")" [ \t]* b:block el:("else" [ \t\n]* elseBranch)? {
      if (e && (init.op != "var" && init.op != "const" && init.op != "=")) {
         expected("an assignment or variable definition ", init.loc);
      }
      if (!e && isAssignment(init)) {
          expected("'an expression after the assignment", init.loc);
      }
      return new ast.Node({loc: location(), op: "if", condition: e ? e[3] : init, lhs: e ? init : undefined, statements: b, elseBranch: el ? el[2] : undefined});
  }
  / "for" [ \t]* f:("(" [ \t\n]* forCondition ")" [ \t]* )? b:block { return new ast.Node({loc: location(), op: "for", condition: f ? f[2] : undefined, statements:b}); }
  / "yield" {
      return new ast.Node({loc: location(), op: "yield"});
    }
  / s: simpleStatement { 
      if (s.op == "in" || s.op == "var_in" || s.op == "const_in") {
          error("'in' is allowed inside a for loop header only");
      }
      return s;
    }

simpleStatement
  = v: varStatement { return v; }
  / [ \t]* i:assignIdentifierList p:("++" / "--" / (assignOp [ \t\n]* expression))? {
        if (!p) {
            if (i.length > 1) {
                expected("assignment operator");
            }
            if (i[0].op == "ellipsisAssign") {
                error("'...' not allowed in this place");
            } else if (i[0].op == "optionalAssign") {
                error("'?' not allowed in this place");
            }
            return i[0];
        }
        if (p == "++") {
          if (i.length > 1) {
              error ("'++' not allowed in this place");
          }
          return new ast.Node({loc: location(), op: "++", lhs: i[0]});
        } else if (p == "--") {
          if (i.length > 1) {
              error ("'--' not allowed in this place");
          }
          return new ast.Node({loc: location(), op: "--", lhs: i[0]});
        }
        if (i.length > 1) {
            i = new ast.Node({loc: location(), op: "tuple", parameters: i});
        } else {
            i = i[0];
        }
        if (p[0] == "in " && i.op == "tuple" && i.parameters.length > 2) {
            error("too many identifiers in tuple left of 'in'");
        }
        if (p[0] == "in" && (i.op == "array" || i.op == "object")) {
            error("array or object not allowed left of 'in'")
        }
        return new ast.Node({loc: location(), op: p[0], lhs: i, rhs: p[2]});
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
  = "(" [ \t\n]* e:assignIdentifierList ")" {
      return new ast.Node({loc: location(), op: "tuple", parameters: e});
    }
  / o:assignObject { return o; }
  / "[" [ \t\n]* e:assignIdentifierList "]" {
      return new ast.Node({loc: location(), op: "array", parameters: e});
    }
  / e:"..."? [ \t]* i:("_" / expression) [ \t]* o:"?"? {
      if (i == "_") {
          i = new ast.Node({loc: location(), op: "id", value: "_"});
      }
      if (e && o) {
          error("'...' and '?' must not be used on the same expression");
      } else if (e) {
          return new ast.Node({loc: location(), op: "ellipsisAssign", lhs: i});
      } else if (o) {
          return new ast.Node({loc: location(), op: "optionalAssign", lhs: i});
      }
      return i;
  }

assignObject
  = "{" [ \t\n]* e:assignKeyIdentifierList? [ \t]* "}" {
      return new ast.Node({loc: location(), op: "object", parameters: e});
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
          error("'...' must not be used in this place");
      } else if (e.op == "optionalAssign") {
          error("'?' must not be used in this place");
      }
      let kv = new ast.Node({loc: location(), op: "keyValue", name: i, lhs: e});
      if (o) {
          kv.op = "optionalKeyValue";
      }
      return kv;
    }
  / "..." [ \t]* e:expression {
      return new ast.Node({loc: location(), op: "ellipsisAssign", lhs: e});
    }

varStatement
  = o:("var" / "const") [ \t]* i:varIdentifierList a:(("=" / "in ") [ \t\n]* expression)? {
        if (i.length > 1) {
            i = new ast.Node({loc: location(), op: "tuple", parameters: i});
        } else {
            i = i[0];
        }
        if (!a) {
            if (o == "const") {
                expected("assignment following 'const'");
            }
            return new ast.Node({loc: location(), op: "var", lhs: i});
        }

        if (a[0] == "in ") {
            if (i.op == "array" || i.op == "object") {
                error("array or object not allowed in this context")
            }
            if (i.op == "tuple") {
                if (i.parameters.length > 2) {
                    error("too many identifiers left of 'in'");
                }
                if (i.parameters[0].op != "id") {
                    error("expression is not allowed on left-hand side of an assignment when used together with 'in'");
                }
                if (i.parameters[1].op != "id") {
                    error("expression is not allowed on left-hand side of an assignment when used together with 'in'");
                }
            } else if (i.op != "id") {
                error("expression is not allowed on left-hand side of an assignment when used together with 'in'");
            }
            return new ast.Node({loc: location(), op: o + "_in" ,lhs: i, rhs: a[2]});
        }

        return new ast.Node({loc: location(), op: o, lhs: i, rhs: a[2]});
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
      return new ast.Node({loc: location(), op: "tuple", parameters: e});
    }
  / o:varObject { return o; }
  / "[" [ \t\n]* e:varIdentifierList "]" {
      return new ast.Node({loc: location(), op: "array", parameters: e});
    }
  / e:"..."? [ \t]* i:("_" / identifier) [ \t]* o:"?"? [ \t]* t:type? {
      if (i == "_") {
          if (t) {
              error("The placeholder '_' must not have a type");
          }
          i = new ast.Node({loc: location(), op: "id", value: "_"});
      }
      if (t) {
          i.rhs = t;
      }
      if (e) {
          i.op = "ellipsisId";
      } else if (o) {
          i.op = "optionalId";
      } else if (e && o) {
          error("'...' and '?' must not be used on the same identifier");
      }
      return i;
  }

varObject
  = "{" [ \t\n]* e:varKeyIdentifierList? [ \t]* "}" {
      return new ast.Node({loc: location(), op: "object", parameters: e});
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
          error("... must not be used in this place");
      } else if (e.op == "optionalId") {
          error("'?' must not be used in this place");
      }
      let kv = new ast.Node({loc: location(), op: "keyValue", name: i, lhs: e});
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
  / "in"

forCondition
  = left: simpleStatement r:(";" [ \t]* expression? ";" [ \t]* simpleStatement?)? {
      if (r) {
          return new ast.Node({loc: location(), op: ";;", lhs: left, condition: r[2], rhs: r[5]});
      }
      if (isAssignment(left) && left.op != "in" && left.op != "var_in" && left.op != "const_in") {
        error("assignment is not allowed in the condition branch of a 'for' loop");
      }
      return left;
    }
  / ";" e:expression? ";" s:simpleStatement? {
        return new ast.Node({loc: location(), op: ";;", condition: e, rhs: s});
    }

elseBranch
  = "if" [ \t]* "(" [ \t\n]* init:simpleStatement e:([ \t]* ";" [ \t]* expression)? ")" [ \t]* b:block el:("else" [ \t\n]* elseBranch)? {
      if (e && (init.op != "var" && init.op != "const" && init.op != "=")) {
         expected("an assignment or variable definition ", init.loc);
      }
      if (!e && isAssignment(init)) {
          expected("'an expression after the assignment", init.loc);
      }
      return new ast.Node({loc: location(), op: "if", condition: e ? e[3] : init, lhs: e ? init : undefined, statements: b, elseBranch: el ? el[2] : undefined});
    }
  / b: block { return new ast.Node({loc: location(), op: "else", statements: b}); } 

expression
  = c: logicOr { return c; }

expressionList
  = e:expression [ \t]* r:("," [ \t\n]* expression [ \t]*)* {
      if (r) {
        let result = [e];
        for(let x of r) {
          result.push(x[2]);
        }
        return result;
      }
      return [e];
    }

logicOr
  = left: logicAnd r:("||" [ \t\n]* logicOr)? {
      if (r) {
         return new ast.Node({loc: location(), op: "||", lhs: left, rhs: r[2]});
      }
      return left;
  }

logicAnd
  = left: comparison r:("&&" [ \t\n]* logicAnd)? {
      if (r) {
         return new ast.Node({loc: location(), op: "&&", lhs: left, rhs: r[2]});
      }
      return left;
  }

comparison
  = left: additive right: comparison2? {
      if (right) {
          right.lhs = left;
          return right;
      }
      return left;
    }

comparison2
  = "==" [ \t\n]* right:additive { return new ast.Node({loc: location(), op: "==", rhs:right}); }
  / "!=" [ \t\n]* right:additive { return new ast.Node({loc: location(), op: "!=", rhs:right}); }
  / "<=" [ \t\n]* right:additive { return new ast.Node({loc: location(), op: "<=", rhs:right}); }
  / ">=" [ \t\n]* right:additive { return new ast.Node({loc: location(), op: ">=", rhs:right}); }
  / ">" [ \t\n]* right:additive { return new ast.Node({loc: location(), op: ">", rhs:right}); }
  / "<" [ \t\n]* right:additive { return new ast.Node({loc: location(), op: "<", rhs:right}); }

additive
  = left:multiplicative right: additive2? {
      if (right) {
          right.lhs = left;
          return right;
      }
      return left;
    }
  
additive2
  = "+" !"+" [ \t\n]* right:additive { return new ast.Node({loc: location(), op: "+", rhs:right}); }
  / "-" !"-" [ \t\n]* right:additive { return new ast.Node({loc: location(), op: "-", rhs:right}); }
  / "|" [ \t\n]* right:additive { return new ast.Node({loc: location(), op: "|", rhs:right}); }
  / "^" [ \t\n]* right:additive { return new ast.Node({loc: location(), op: "^", rhs:right}); }

multiplicative
  = left:unary right:multiplicative2? {
      if (right) {
          right.lhs = left;
          return right;
      }
      return left;
    }

multiplicative2
  = "*" [ \t\n]* right:multiplicative { return new ast.Node({loc: location(), op: "*", rhs:right}); }
  / "/" [ \t\n]* right:multiplicative { return new ast.Node({loc: location(), op: "/", rhs:right}); }
  / "%" [ \t\n]* right:multiplicative { return new ast.Node({loc: location(), op: "%", rhs:right}); }
  / "&" [ \t\n]* right:multiplicative { return new ast.Node({loc: location(), op: "&", rhs:right}); }
  / "&^" [ \t\n]* right:multiplicative { return new ast.Node({loc: location(), op: "&^", rhs:right}); }
  / "<<" [ \t\n]* right:multiplicative { return new ast.Node({loc: location(), op: "<<", rhs:right}); }
  / ">>" [ \t\n]* right:multiplicative { return new ast.Node({loc: location(), op: ">>", rhs:right}); }

unary
  = t: typedLiteral { return t; }
  / c: typeCast { return c; }
  / "+" [ \t\n]* p:unary { return new ast.Node({loc: location(), op: "unary+", rhs:p}); }
  / "-" [ \t\n]* p:unary { return new ast.Node({loc: location(), op: "unary-", rhs:p}); }
  / "!" [ \t\n]* p:unary { return new ast.Node({loc: location(), op: "unary!", rhs:p}); }
  / "^" [ \t\n]* p:unary { return new ast.Node({loc: location(), op: "unary^", rhs:p}); }
  / "*" [ \t\n]* p:unary { return new ast.Node({loc: location(), op: "unary*", rhs:p}); }
  / "&" [ \t\n]* p:unary { return new ast.Node({loc: location(), op: "unary&", rhs:p}); }
  / p: primary { return p; }

typedLiteral
  = "[" [ \t]* e:expression? "]" [ \t]* t:type [ \t]* l: array {
      if (e) {
          l.lhs = new ast.Node({loc: location(), op: "arrayType", rhs: t, lhs: e});
      } else {
          l.lhs = new ast.Node({loc: location(), op: "sliceType", rhs: t});
      }
      return l;
    }
  / "(" [ \t]* t:typeList [ \t]* ")" [ \t]* l: tuple {
      l.lhs = new ast.Node({loc: location(), op: "tupleType", parameters: t});
      return l;
    }
  / "struct" [ \t]* e:("extends" [ \t]+ type [ \t]*)? "{" [ \t]* "\n" [ \t]* f:structField* [ \t]* "}" [ \t]* l: object {
        let ext = e ? e[2] : null;
        l.lhs = new ast.Node({loc: location(), op: "structType", parameters: f, lhs: ext});
        return l;
    }
  / i :identifier l:object {
      i.op = "basicType";
      l.lhs = i;
      return l;
  }

typeCast
  = "(" [ \t]* t:type [ \t]* ")" [ \t]* e: primary {
        if (e.op == "array" || e.op == "tuple" || e.op == "object") {
            e.lhs = t;
            return e;
        }
        return new ast.Node({loc: location(), op: "typeCast", lhs: t, rhs: e});
    }

primary
  = [ \t\n]* p:primary2 [ \t]* m:member* {
        if (!m) {
            return p;
        }
        let left = p;
        for(let x of m) {
            x.lhs = left;
            left = x;
        }
        return left;
    }

primary2
  = n: number { return n; }
  / f:func { return f; }
  / "true" { return new ast.Node({loc: location(), op: "bool", value: "true"}); }
  / "false" { return new ast.Node({loc: location(), op: "bool", value: "false"}); }
  / "null" { return new ast.Node({loc: location(), op: "null"}); }
  / i: identifier {
      return i;
    }
  / s: string { return s; }
  / "(" [ \t\n]* e: expressionList ")" {
      if (e.length == 1) {
          return e[0];
      }
      return new ast.Node({loc: location(), op: "tuple", parameters: e});
    }
  / "func" [ \t]* "(" [ \t]* p:parameters? ")" [ \t]* t:type? [ \t]* b:(block / ("=>" [ \t]* expression)) {
      if (b.length > 1 && b[0] == "=>") {
          return new ast.Node({loc: location(), op: "=>", parameters: p, lhs: t, rhs: b[2]});
      }
      if (!t) {
          expected("return type in lambda expression");
      }
      return new ast.Node({loc: location(), op: "=>", parameters: p, lhs: t, statements: b});
    }
  / o:object { return o; }
  / a:array { return a; }

array
  = "[" [ \t\n]* e:expressionList? [ \t]* "]" {
      return new ast.Node({loc: location(), op: "array", parameters: e});
    }

object
  = "{" [ \t\n]* e:keyValueList? [ \t]* "}" {
      return new ast.Node({loc: location(), op: "object", parameters: e});
    }

tuple
  = "(" [ \t\n]* e: expressionList ")" & {
      return e.length > 1
    } {
        return new ast.Node({loc: location(), op: "tuple", parameters: e});
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
      return new ast.Node({loc: location(), op: "keyValue", name: i, lhs: e});
    }
  / "..." i:identifier {
      i.op = "ellipsisId";
      return i;
    }

number "number"
  = digits:$([0-9]* "." [0-9]+) { return new ast.Node({loc: location(), op: "float", value: digits}); }
  / "0x" digits:$([0-9a-f]+) { return new ast.Node({loc: location(), op: "int", value: "0x" + digits}); }
  / digits:$([0-9]+) { return new ast.Node({loc: location(), op: "int", value: digits}); }

member
  = "." [ \t\n]* i:identifier [ \t]* { return new ast.Node({loc: location(), op: ".", name:i}); }
  / "[" [ \t\n]* e:expression? r:(":" expression?)? "]" [ \t]* {
      if (!e && !r) {
          expected("an index or range expression between brackets");
      }
      if (r) {
          e = new ast.Node({loc: location(), "op":":", lhs: e, rhs: r[1]});
      }
      return new ast.Node({loc: location(), op: "[", rhs: e});
    }
  / "(" [ \t\n]* a:arguments? ")" [ \t]* { return new ast.Node({loc: location(), op: "(", parameters: a}); }
  / "<" [ \t]* t:typeList [ \t]* ">" { return new ast.Node({loc: location(), op: "genericInstance", genericParameters: t}); }

arguments
  = e:expression r:("," [ \t\n]* expression)* {
      if (r) {
        let result = [e];
        for(let x of r) {
          result.push(x[2]);
        }
        return result;
      }
      return [e];
    }

identifier "identifier"
  = i:$([a-zA-Z][a-zA-Z_0-9]*) & { 
      return !isKeyword(i);
    } {
      return new ast.Node({loc: location(), op: "id", value: i});
    }

string "string"
  = "\"" s:$stringchars* "\"" { return new ast.Node({loc: location(), op: "str", value: s}); }

stringchars
  = $("\\" .)
  / $(chars:[^"\\]+)

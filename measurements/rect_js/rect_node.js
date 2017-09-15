function Rect() {
	this.pos = new Point(0, 0);
	this.size = new Size(0, 0);
}

Rect.prototype.include = function(p) {
	var result = new Rect();
	result.pos.x = this.pos.x;
	result.pos.y = this.pos.y;
	result.size.width = this.size.width;
	result.size.height = this.size.height;
	if (p.x < this.pos.x) {
		result.size.width = this.size.width + this.pos.x - p.x
		result.pos.x = p.x
	} else if (p.x >= this.pos.x + this.size.width) {
		result.size.width = p.x - this.pos.x + 1
	}
	if (p.y < this.pos.y) {
		result.size.height = this.size.height + this.pos.y - p.y
		result.pos.y = p.y
	} else if (p.y >= this.pos.y + this.size.height) {
		result.size.height = p.y - this.pos.y + 1
	}
	return result
}

function Size(width, height) {
	this.width = width
	this.height = height
}

function Point(x, y) {
	this.x = x
	this.y = y
}

var r = new Rect();
r.pos.x = 12
r.pos.y = 23
r.size.width = 2
r.size.height = 3
for (var i = 0; i < 320000000; i++) {
	r = r.include(new Point(i % 100, i % 200))
}
console.log(r.pos.x, r.pos.y, r.size.width, r.size.height)

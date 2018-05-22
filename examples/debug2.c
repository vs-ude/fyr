#include <stdint.h>
#include <stdlib.h>
#include "fyr.h"

struct Point {
    int64_t x;
};

int64_t f_~Point__size(addr_t v_this);
int64_t f_main();
void f_dome(addr_t v_p);
void f_init();
int main(int argc, char** argv);

int64_t f_~Point__size(addr_t v_this) {
    /* this = decl_param ptr  */;
    /* $return = decl_result s64  */;
    /* if (ne addr this, 0) */;
    if (v_this != 0) {
        /* decref this, -1 */;
        fyr_decref(v_this, 0);
    };
    /* return s64 0 */;
    return 0;
    /* end  */;
}

int64_t f_main() {
    /* $return = decl_result s64  */;
    /* return s64 0 */;
    return 0;
    /* end  */;
}

void f_dome(addr_t v_p) {
    addr_t nr_1;
    /* p = decl_param ptr  */;
    /* $mem = store Point (%1 = alloc Point ), 0, (struct Point 0) */;
    *(struct Point*)(nr_1 = fyr_alloc(8)) = (struct Point){0};
    /* p = copy ptr %1 */;
    v_p = nr_1;
    /* if (ne addr p, 0) */;
    if (v_p != 0) {
        /* free p */;
        fyr_free(v_p);
    };
    /* end  */;
}

void f_init() {

}

int main(int argc, char** argv) {
    f_init();
    return f_main();
}


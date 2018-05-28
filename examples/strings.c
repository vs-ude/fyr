#include <stdint.h>
#include <stdlib.h>
#include "fyr.h"

struct {
    int_t refcount;
    int_t size;
    uint8_t data[4];
} str_0 = {1, 4,68,117,100,97};

struct {
    int_t refcount;
    int_t size;
    uint8_t data[2];
} str_1 = {1, 2,33,33};

struct {
    int_t refcount;
    int_t size;
    uint8_t data[5];
} str_2 = {1, 5,72,97,108,108,111};

int64_t f_main();
int64_t f_name();
int64_t f_lenof(addr_t v_str);
int64_t f_lenof2(addr_t v_str);
void f_init();
int main(int argc, char** argv);

int64_t f_main() {
    int64_t nr_0;
    int64_t nr_3;
    /* $return = decl_result s64  */;
    /* %0 = call () => (s64) 1 */;
    nr_0 = f_name();
    /* %3 = add s64 %0, (call (ptr) => (s64) 2, %1) */;
    nr_3 = nr_0 + f_lenof(&(str_0.data)[0]);
    /* return s64 (add s64 %3, (call (ptr) => (s64) 3, %4)) */;
    return nr_3 + f_lenof2(&(str_1.data)[0]);
    /* end  */;
}

int64_t f_name() {
    /* $return = decl_result s64  */;
    /* return s64 (len_arr sint %7) */;
    return fyr_len_arr(&(str_2.data)[0]);
    /* end  */;
}

int64_t f_lenof(addr_t v_str) {
    /* str = decl_param ptr  */;
    /* $return = decl_result s64  */;
    /* return s64 (len_arr sint str) */;
    return fyr_len_arr(v_str);
    /* end  */;
}

int64_t f_lenof2(addr_t v_str) {
    /* str = decl_param ptr  */;
    /* $return = decl_result s64  */;
    /* s2 = decl_var ptr  */;
    /* return s64 (len_arr sint (incref_arr addr str)) */;
    return fyr_len_arr(fyr_incref_arr(v_str));
    /* end  */;
}

void f_init() {

}

int main(int argc, char** argv) {
    f_init();
    return f_main();
}


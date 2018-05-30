#include <stdio.h>
#include <stdint.h>
#include <stdlib.h>
#include "fyr.h"

struct {
    int_t refcount;
    int_t size;
    uint8_t data[11];
} str_0 = {1, 11,72,101,108,108,111,32,87,111,114,108,100};

struct {
    int_t refcount;
    int_t size;
    uint8_t data[4];
} str_1 = {1, 4,68,117,100,97};

struct {
    int_t refcount;
    int_t size;
    uint8_t data[2];
} str_2 = {1, 2,33,33};

struct {
    int_t refcount;
    int_t size;
    uint8_t data[5];
} str_3 = {1, 5,72,97,108,108,111};

struct localSlice {
    addr_t data_ptr;
    int_t data_length;
};

struct strongSlice {
    struct localSlice base;
    addr_t array_ptr;
};

struct ta_struct0 {
    int64_t field0[4];
};

int64_t f_main();
int64_t f_name();
int64_t f_lenof(addr_t v_str);
int64_t f_lenof2(addr_t v_str);
int64_t f_appendMe();
void f_init();
void f_dtr_u0(addr_t v_pointer);
int main(int argc, char** argv);

int64_t f_main() {
    int64_t nr_2;
    int64_t nr_5;
    int64_t nr_8;
    /* $return = decl_result s64  */;
    /* call ([object Object]) => (s64) 0, %0 */;
    puts((const void*)(&(str_0.data)[0]));
    /* %2 = call () => (s64) 2 */;
    nr_2 = f_name();
    /* %5 = add s64 %2, (call (addr) => (s64) 3, %3) */;
    nr_5 = nr_2 + f_lenof(&(str_1.data)[0]);
    /* %8 = add s64 %5, (call (addr) => (s64) 4, %6) */;
    nr_8 = nr_5 + f_lenof2(&(str_2.data)[0]);
    /* return s64 (add s64 %8, (call () => (s64) 5)) */;
    return nr_8 + f_appendMe();
    /* end  */;
}

int64_t f_name() {
    /* $return = decl_result s64  */;
    /* return s64 (len_arr sint %11) */;
    return fyr_len_arr(&(str_3.data)[0]);
    /* end  */;
}

int64_t f_lenof(addr_t v_str) {
    /* str = decl_param addr  */;
    /* $return = decl_result s64  */;
    /* return s64 (len_arr sint str) */;
    return fyr_len_arr(v_str);
    /* end  */;
}

int64_t f_lenof2(addr_t v_str) {
    addr_t v_s2;
    int_t nr_15;
    /* str = decl_param addr  */;
    /* $return = decl_result s64  */;
    /* s2 = decl_var addr  */;
    /* s2 = incref_arr addr str */;
    v_s2 = fyr_incref_arr(v_str);
    /* %15 = len_arr sint s2 */;
    nr_15 = fyr_len_arr(v_s2);
    /* if (ne addr s2, 0) */;
    if (v_s2 != 0) {
        /* decref_arr s2, -1 */;
        fyr_decref_arr(v_s2, 0);
    };
    /* return s64 %15 */;
    return nr_15;
    /* end  */;
}

int64_t f_appendMe() {
    struct strongSlice v_n;
    static struct ta_struct0 s_wrong = (struct ta_struct0){1, 0, 0, 0};
    struct strongSlice v_arr;
    struct strongSlice v_arr2;
    addr_t nr_17;
    addr_t nr_20;
    addr_t nr_22;
    addr_t nr_26;
    int64_t nr_36;
    /* $return = decl_result s64  */;
    /* n = decl_var strongSlice  */;
    /* wrong = decl_var struct{...}  */;
    /* arr = decl_var strongSlice  */;
    /* arr2 = decl_var strongSlice  */;
    /* %17 = alloc_arr addr 100, 8 */;
    nr_17 = fyr_alloc_arr(100, 8);
    /* n = struct strongSlice %17, 100, %17 */;
    v_n = (struct strongSlice){nr_17, 100, nr_17};
    /* %20 = alloc_arr addr 7, 8 */;
    nr_20 = fyr_alloc_arr(7, 8);
    /* $mem = store s64 %20, 0, 1 */;
    *(int64_t*)nr_20 = 1;
    /* $mem = store s64 %20, 8, 2 */;
    *(int64_t*)((char*)nr_20 + 8) = 2;
    /* $mem = store s64 %20, 16, 3 */;
    *(int64_t*)((char*)nr_20 + 16) = 3;
    /* arr = struct strongSlice %20, 7, %20 */;
    v_arr = (struct strongSlice){nr_20, 7, nr_20};
    /* %22 = alloc_arr addr 4, 8 */;
    nr_22 = fyr_alloc_arr(4, 8);
    /* $mem = store s64 %22, 0, 4 */;
    *(int64_t*)nr_22 = 4;
    /* $mem = store s64 %22, 8, 5 */;
    *(int64_t*)((char*)nr_22 + 8) = 5;
    /* $mem = store s64 %22, 16, 6 */;
    *(int64_t*)((char*)nr_22 + 16) = 6;
    /* $mem = store s64 %22, 24, 7 */;
    *(int64_t*)((char*)nr_22 + 24) = 7;
    /* arr2 = struct strongSlice %22, 4, %22 */;
    v_arr2 = (struct strongSlice){nr_22, 4, nr_22};
    /* %26 = member addr n, 1 */;
    nr_26 = v_n.array_ptr;
    /* %36 = add s64 (add s64 (sub sint (len_arr sint %26), (div sint (sub sint (member addr (member localSlice n, 0), 0), %26), 8)), (member sint (member localSlice n, 0), 1)), (load s64 (addr_of addr wrong), 0) */;
    nr_36 = ((fyr_len_arr(nr_26) - ((v_n.base).data_ptr - nr_26) / 8) + (v_n.base).data_length) + *(int64_t*)((addr_t)(&s_wrong));
    /* call (addr) => () 7, (addr_of addr n) */;
    f_dtr_u0((addr_t)(&v_n));
    /* call (addr) => () 7, (addr_of addr arr) */;
    f_dtr_u0((addr_t)(&v_arr));
    /* call (addr) => () 7, (addr_of addr arr2) */;
    f_dtr_u0((addr_t)(&v_arr2));
    /* return s64 %36 */;
    return nr_36;
    /* end  */;
}

void f_init() {

}

void f_dtr_u0(addr_t v_pointer) {
    addr_t nr_38;
    /* pointer = decl_param addr  */;
    /* %38 = load addr pointer, 16 */;
    nr_38 = *(addr_t*)(v_pointer + 16);
    /* if (ne addr %38, 0) */;
    if (nr_38 != 0) {
        /* free_arr %38 */;
        fyr_free_arr(nr_38);
    };
    /* end  */;
}

int main(int argc, char** argv) {
    f_init();
    return f_main();
}


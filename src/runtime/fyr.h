#define EXIT_FAILURE 1

#include <stddef.h>
#include <stdbool.h>
#include <stdint.h>

typedef uint8_t* addr_t;
typedef int32_t int_t;
typedef uint32_t uint_t;

typedef void (*fyr_dtr_t)(addr_t ptr);
typedef void (*fyr_dtr_arr_t)(addr_t ptr, int_t count);

addr_t fyr_alloc(int_t size);
addr_t fyr_alloc_arr(int_t count, int_t size);
void fyr_free(addr_t, fyr_dtr_t dtr);
void fyr_free_arr(addr_t, fyr_dtr_arr_t dtr);
bool fyr_isnull(addr_t);
bool fyr_isnull_arr(addr_t);
void fyr_notnull_ref(addr_t);
addr_t fyr_incref(addr_t ptr);
addr_t fyr_incref_arr(addr_t ptr);
void fyr_decref(addr_t ptr, fyr_dtr_t dtr);
void fyr_decref_arr(addr_t ptr, fyr_dtr_arr_t dtr);
void fyr_lock(addr_t ptr);
void fyr_unlock(addr_t ptr, fyr_dtr_t dtr);
int_t fyr_len_arr(addr_t ptr);
int_t fyr_len_str(addr_t ptr);
int_t fyr_min(int_t a, int_t b);
int_t fyr_max(int_t a, int_t b);

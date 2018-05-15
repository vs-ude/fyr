#define EXIT_FAILURE 1

#include <stddef.h>
#include <stdbool.h>

typedef char* addr_t;
typedef long int_t;
typedef unsigned long uint_t;

typedef void (*fyr_dtr_t)(addr_t ptr);

addr_t fyr_alloc(size_t count, size_t size);
void fyr_free(addr_t);
bool fyr_isnull(addr_t);
addr_t fyr_incref(addr_t ptr);
void fyr_decref(addr_t ptr, fyr_dtr_t dtr);

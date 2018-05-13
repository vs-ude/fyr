#define EXIT_FAILURE 1

#include <stddef.h>

typedef char* addr_t;
typedef long int_t;
typedef unsigned long uint_t;

typedef void (*fyr_dtr_t)(void *ptr);

void* fyr_alloc(size_t count, size_t size);
void fyr_free(void *ptr);
void fyr_incref(void *ptr);
void fyr_decref(void *ptr, fyr_dtr_t dtr);

/* Tiny libc for RNNoise in WebAssembly: memory helpers, a bump allocator, and libm.
   exp/log/pow/sin/cos/tanh/atan come from JavaScript's Math (imports "env"); the rest are wasm instructions. */
#include <stddef.h>
#include <stdint.h>
extern unsigned char __heap_base;
static uintptr_t brk_ = 0;
void *malloc(size_t n){
  if(!brk_) brk_=(uintptr_t)&__heap_base;
  uintptr_t p=(brk_+15)&~(uintptr_t)15, end=p+n;
  size_t have=__builtin_wasm_memory_size(0)*65536;
  if(end>have){ size_t pages=(end-have+65535)/65536; if(__builtin_wasm_memory_grow(0,pages)==(size_t)-1) return 0; }
  brk_=end; return (void*)p;
}
void free(void *p){ (void)p; }            /* RNNoise state is made once and reused */
void *memset(void *d,int c,size_t n){ unsigned char *p=d; while(n--) *p++=(unsigned char)c; return d; }
void *memcpy(void *d,const void *s,size_t n){ unsigned char *a=d; const unsigned char *b=s; while(n--) *a++=*b++; return d; }
void *memmove(void *d,const void *s,size_t n){ unsigned char *a=d; const unsigned char *b=s; if(a<b) while(n--) *a++=*b++; else { a+=n; b+=n; while(n--) *--a=*--b; } return d; }
void *calloc(size_t n,size_t m){ void *p=malloc(n*m); if(p) memset(p,0,n*m); return p; }
void *realloc(void *p,size_t n){ void *q=malloc(n); if(q&&p) memcpy(q,p,n); return q; }
int memcmp(const void *a,const void *b,size_t n){ const unsigned char *x=a,*y=b; for(;n;n--,x++,y++) if(*x!=*y) return *x-*y; return 0; }
size_t strlen(const char *s){ size_t n=0; while(s[n]) n++; return n; }
int strcmp(const char *a,const char *b){ while(*a&&*a==*b){a++;b++;} return (unsigned char)*a-(unsigned char)*b; }
void abort(void){ __builtin_trap(); }
int abs(int x){ return x<0?-x:x; }
/* files are never used (the model is built in) */
typedef struct __sFILE FILE;
FILE *fopen(const char *p,const char *m){ (void)p;(void)m; return 0; }
int fclose(FILE *f){ (void)f; return 0; }
size_t fread(void *p,size_t s,size_t n,FILE *f){ (void)p;(void)s;(void)n;(void)f; return 0; }
size_t fwrite(const void *p,size_t s,size_t n,FILE *f){ (void)p;(void)s;(void)f; return n; }
int fseek(FILE *f,long o,int w){ (void)f;(void)o;(void)w; return -1; }
long ftell(FILE *f){ (void)f; return -1; }
int printf(const char *f,...){ (void)f; return 0; }
int fprintf(FILE *s,const char *f,...){ (void)s;(void)f; return 0; }
/* libm */
__attribute__((import_module("env"),import_name("exp"))) double js_exp(double);
__attribute__((import_module("env"),import_name("log"))) double js_log(double);
__attribute__((import_module("env"),import_name("pow"))) double js_pow(double,double);
__attribute__((import_module("env"),import_name("sin"))) double js_sin(double);
__attribute__((import_module("env"),import_name("cos"))) double js_cos(double);
__attribute__((import_module("env"),import_name("tanh"))) double js_tanh(double);
__attribute__((import_module("env"),import_name("atan"))) double js_atan(double);
double exp(double x){ return js_exp(x); }        float expf(float x){ return (float)js_exp(x); }
double log(double x){ return js_log(x); }        float logf(float x){ return (float)js_log(x); }
double log10(double x){ return js_log(x)*0.43429448190325176; } float log10f(float x){ return (float)(js_log(x)*0.43429448190325176); }
double pow(double a,double b){ return js_pow(a,b); } float powf(float a,float b){ return (float)js_pow(a,b); }
double sin(double x){ return js_sin(x); }        float sinf(float x){ return (float)js_sin(x); }
double cos(double x){ return js_cos(x); }        float cosf(float x){ return (float)js_cos(x); }
double tanh(double x){ return js_tanh(x); }      float tanhf(float x){ return (float)js_tanh(x); }
double atan(double x){ return js_atan(x); }      float atanf(float x){ return (float)js_atan(x); }
double sqrt(double x){ return __builtin_sqrt(x); } float sqrtf(float x){ return __builtin_sqrtf(x); }
double floor(double x){ return __builtin_floor(x); } float floorf(float x){ return __builtin_floorf(x); }
double ceil(double x){ return __builtin_ceil(x); }   float ceilf(float x){ return __builtin_ceilf(x); }
double fabs(double x){ return __builtin_fabs(x); }   float fabsf(float x){ return __builtin_fabsf(x); }
double fmax(double a,double b){ return __builtin_fmax(a,b); } float fmaxf(float a,float b){ return __builtin_fmaxf(a,b); }
double fmin(double a,double b){ return __builtin_fmin(a,b); } float fminf(float a,float b){ return __builtin_fminf(a,b); }
long lrint(double x){ return (long)__builtin_rint(x); } long lrintf(float x){ return (long)__builtin_rintf(x); }

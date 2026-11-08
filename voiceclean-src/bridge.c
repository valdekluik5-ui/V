/* RNNoise for Suffler's "Only my voice": 48 kHz, 480-sample frames, samples scaled like 16-bit PCM. */
#include <stdlib.h>
#include "rnnoise.h"
static DenoiseState *st;
__attribute__((export_name("buf"))) float *buf(int n){ return (float*)malloc((size_t)n*sizeof(float)); }
/* a fresh start for each recording */
__attribute__((export_name("reset"))) int reset(void){ if(!st) st=rnnoise_create(NULL); else rnnoise_init(st,NULL); return st!=0; }
/* cleans `frames` frames in place; writes each frame's voice probability to vad */
__attribute__((export_name("run"))) void run(float *b,int frames,float *vad){ for(int i=0;i<frames;i++) vad[i]=rnnoise_process_frame(st,b+480*i,b+480*i); }

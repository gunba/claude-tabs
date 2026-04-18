// Fixed workload for the tracer benchmark test (tests/tracer_bench.rs).
// Compile with: gcc -O2 -o /tmp/openat_bench src-tauri/tests/openat_bench.c
// Usage: /tmp/openat_bench N [path]
// Performs N openat(O_RDONLY) calls on `path` (default /etc/os-release),
// giving a deterministic event count for measuring per-event tracer cost.
#include <fcntl.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>

int main(int argc, char **argv) {
    int n = argc > 1 ? atoi(argv[1]) : 1000;
    const char *path = argc > 2 ? argv[2] : "/etc/os-release";
    struct timespec t0, t1;
    clock_gettime(CLOCK_MONOTONIC, &t0);
    for (int i = 0; i < n; i++) {
        int fd = openat(AT_FDCWD, path, O_RDONLY);
        if (fd >= 0) close(fd);
    }
    clock_gettime(CLOCK_MONOTONIC, &t1);
    long ns = (t1.tv_sec - t0.tv_sec) * 1000000000L + (t1.tv_nsec - t0.tv_nsec);
    fprintf(stderr, "bench: %d openat in %ld ns = %.1f ns/op\n", n, ns, (double)ns / n);
    return 0;
}

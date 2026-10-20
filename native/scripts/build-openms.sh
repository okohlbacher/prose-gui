#!/bin/bash
# Native (host toolchain) build of libOpenMS, the ProSE tool and the ProSE class tests.
#
#   build-openms.sh <openms-src> <build-dir>
#
# <openms-src> is any OpenMS checkout; <build-dir> is created if needed (an existing configured
# directory is reconfigured in place, so the script is safe to re-run). It runs on the host
# toolchain, outside native/scripts/in-env.sh. Environment overrides: JOBS (default 100),
# VCPKG_BINARY_CACHE, VCPKG_MAX_CONCURRENCY (default 32).
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <openms-src> <build-dir>" >&2
  exit 2
fi
SRC=$(realpath "$1")
BUILD=$(realpath -m "$2")
JOBS=${JOBS:-100}
BINCACHE=${VCPKG_BINARY_CACHE:-/scratch/sachsenb/vcpkg-bincache-native}

TOOLCHAIN="$SRC/vcpkg/scripts/buildsystems/vcpkg.cmake"
[ -f "$SRC/CMakeLists.txt" ] || { echo "error: $SRC is not an OpenMS checkout" >&2; exit 1; }
[ -f "$TOOLCHAIN" ] || { echo "error: vcpkg toolchain missing: $TOOLCHAIN (submodule not checked out?)" >&2; exit 1; }

# linuxbrew's binutils (as 2.36) cannot assemble ONNX Runtime's AVX-NE-CONVERT code: drop it from PATH.
PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v 'linuxbrew' | paste -sd: -)
export PATH

# Build the vcpkg dependencies once and reuse them across builds from the binary cache.
mkdir -p "$BINCACHE"
export VCPKG_BINARY_SOURCES="clear;files,$BINCACHE,readwrite"
export VCPKG_MAX_CONCURRENCY=${VCPKG_MAX_CONCURRENCY:-32}

# Thermo RAW is off because its bridge needs dotnet; OpenTIMS is off because the app does not read .d files.
cmake -G Ninja -S "$SRC" -B "$BUILD" \
  -DCMAKE_BUILD_TYPE=Release \
  -DOPENMS_USE_VCPKG=ON \
  -DCMAKE_TOOLCHAIN_FILE="$TOOLCHAIN" \
  -DVCPKG_TARGET_TRIPLET=x64-linux-dynamic \
  -DVCPKG_MANIFEST_FEATURES=onnxruntime \
  -DWITH_ONNX=ON \
  -DWITH_GUI=OFF \
  -DWITH_THERMO_RAW=OFF \
  -DWITH_OPENTIMS=OFF \
  -DENABLE_DOCS=OFF \
  -DPYOPENMS=OFF \
  -DENABLE_CLASS_TESTING=ON \
  -DENABLE_TOPP_TESTING=ON

# FileInfo, ParquetDiff and FuzzyDiff are what the TOPP_ProSE tests run to inspect and compare outputs;
# without them those tests report "Not Run". PeptDeepLibraryPredictor_test is part of the PeptDeep set, the
# QPX tests check the QPX Parquet output the app reads.
cmake --build "$BUILD" -j "$JOBS" --target \
  OpenMS ProSE FileInfo ParquetDiff FuzzyDiff \
  ProSEAlgorithm_test PeptDeepInference_test PeptDeepRescoring_test PeptDeepLibraryPredictor_test \
  OpenSearchModificationAnalysis_test Percolator_test \
  QPXFile_test QPXCollectionExport_test QPXValueValidation_test QPXIdentity_test ArrowIOHelpers_test

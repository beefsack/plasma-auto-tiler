cmake_minimum_required(VERSION 3.19)

project(plasma-auto-tiler-native-effect LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(ECM 6.26.0 REQUIRED NO_MODULE)
set(CMAKE_MODULE_PATH ${ECM_MODULE_PATH})

include(KDEInstallDirs)
include(KDECMakeSettings)
include(ECMSetupQtPluginMacroNames)

find_package(Qt6 REQUIRED COMPONENTS Core DBus Gui Widgets)

find_package(KWin REQUIRED)
find_package(KF6CoreAddons REQUIRED)
find_package(KF6Config REQUIRED)
find_package(KF6ColorScheme REQUIRED)
find_package(KF6I18n REQUIRED)
find_package(KF6KCMUtils REQUIRED)
find_package(KF6WidgetsAddons REQUIRED)
include("${KF6I18n_DIR}/KF6I18nMacros.cmake")

ecm_setup_qtplugin_macro_names(
    MACRO_NAMES
        KWIN_EFFECT_FACTORY
        KWIN_EFFECT_FACTORY_ENABLED
        KWIN_EFFECT_FACTORY_SUPPORTED
        KWIN_EFFECT_FACTORY_SUPPORTED_ENABLED
)

set(config_SOURCES)
kconfig_add_kcfg_files(config_SOURCES activeborderconfig.kcfgc)

# AR10 effect Rust: a Cargo workspace staticlib
# (crates/tiler-kwin-effect-ffi, group highlight policy plus the slice 1
# drag oracle) built by a plain custom command invoking Cargo. No Corrosion,
# no new system dependency: cargo ships with the existing devenv Rust
# toolchain. The crate reuses serde and tiler-core gates, replacing the
# bare-rustc build and the hand-written group JSON parser. Rust keeps group
# visibility and drag verdict policy behind the same POD C ABI.
# find_program/find_package stay before all consumers so linkage never
# relies on transitive libs.
find_program(CARGO_PROGRAM cargo REQUIRED)
# The Rust staticlib references pthread/dl (std thread internals, backtrace
# symbolization). Link them explicitly and portably so the shared plugins
# do not rely on transitive linkage.
find_package(Threads REQUIRED)

# Workspace layout: this file lives at kwin/native-effect under the
# workspace root. Nix/flake wires the workspace inputs via its source
# fileset; a missing workspace fails this command closed.
set(EFFECT_WORKSPACE_ROOT "${CMAKE_CURRENT_SOURCE_DIR}/../..")
set(EFFECT_FFI_CRATE_DIR "${EFFECT_WORKSPACE_ROOT}/crates/tiler-kwin-effect-ffi")
set(EFFECT_CARGO_TARGET_DIR "${CMAKE_CURRENT_BINARY_DIR}/cargo-effect")
set(EFFECT_STATICLIB "${EFFECT_CARGO_TARGET_DIR}/release/libtiler_kwin_effect_ffi.a")
# Nix offline vendor: when CARGO_NET_OFFLINE=true (set by the Nix
# mkNativeEffect derivation alongside its CARGO_HOME vendor config), pass
# --offline so Cargo fails closed instead of hitting the network. Host
# builds leave the env unset and keep the default locked (network-capable)
# behavior with no channel/target change.
if(DEFINED ENV{CARGO_NET_OFFLINE} AND "$ENV{CARGO_NET_OFFLINE}" STREQUAL "true")
    set(EFFECT_CARGO_OFFLINE_ARG --offline)
else()
    set(EFFECT_CARGO_OFFLINE_ARG "")
endif()
add_custom_command(
    OUTPUT "${EFFECT_STATICLIB}"
    COMMAND "${CARGO_PROGRAM}"
        build
        --release
        --locked
        ${EFFECT_CARGO_OFFLINE_ARG}
        --manifest-path "${EFFECT_FFI_CRATE_DIR}/Cargo.toml"
        -p tiler-kwin-effect-ffi
        --target-dir "${EFFECT_CARGO_TARGET_DIR}"
    DEPENDS
        "${EFFECT_WORKSPACE_ROOT}/Cargo.toml"
        "${EFFECT_WORKSPACE_ROOT}/Cargo.lock"
        "${EFFECT_FFI_CRATE_DIR}/Cargo.toml"
        "${EFFECT_FFI_CRATE_DIR}/src/lib.rs"
        "${EFFECT_FFI_CRATE_DIR}/src/group_highlight.rs"
        "${EFFECT_FFI_CRATE_DIR}/src/drag_oracle.rs"
        "${EFFECT_WORKSPACE_ROOT}/crates/tiler-core/Cargo.toml"
        "${EFFECT_WORKSPACE_ROOT}/crates/tiler-core/src/lib.rs"
        "${EFFECT_WORKSPACE_ROOT}/crates/tiler-core/src/ids.rs"
        "${EFFECT_WORKSPACE_ROOT}/crates/tiler-core/src/bounds.rs"
        "${EFFECT_WORKSPACE_ROOT}/crates/tiler-core/src/geometry.rs"
    COMMENT "Building tiler-kwin-effect-ffi staticlib with Cargo"
    VERBATIM
)
add_custom_target(plasma-auto-tiler-effect-ffi-rs DEPENDS "${EFFECT_STATICLIB}")

kcoreaddons_add_plugin(plasma-auto-tiler-active-border
    INSTALL_NAMESPACE "kwin/effects/plugins"
    SOURCES
        activewindowborder.h
        activewindowborder.cpp
        drag_oracle_ffi.h
        group_highlight_ffi.h
        ${config_SOURCES}
)
add_dependencies(plasma-auto-tiler-active-border plasma-auto-tiler-effect-ffi-rs)
target_link_libraries(plasma-auto-tiler-active-border PRIVATE
    "${EFFECT_STATICLIB}"
    Threads::Threads
    ${CMAKE_DL_LIBS}
    KWin::kwin
    KF6::ConfigCore
    KF6::ConfigGui
    KF6::ColorScheme
    Qt6::Core
    Qt6::Gui
    Qt6::DBus
)
target_compile_options(plasma-auto-tiler-active-border PRIVATE -Wall -Wextra -Werror)

set(kcm_SOURCES
    activeborderconfig_module.cpp
    activeborderconfig_module.h
    shortcutreconciler.cpp
    shortcutreconciler.h
    ${config_SOURCES}
)
ki18n_wrap_ui(kcm_SOURCES activeborderconfig.ui)

kcoreaddons_add_plugin(plasma-auto-tiler-active-border_config
    INSTALL_NAMESPACE "kwin/effects/configs"
    SOURCES ${kcm_SOURCES}
)
target_compile_definitions(plasma-auto-tiler-active-border_config PRIVATE -DTRANSLATION_DOMAIN="kwin")
target_link_libraries(plasma-auto-tiler-active-border_config PRIVATE
    KF6::CoreAddons
    KF6::ConfigCore
    KF6::ConfigGui
    KF6::I18n
    KF6::KCMUtils
    KF6::WidgetsAddons
    Qt6::Core
    Qt6::DBus
    Qt6::Widgets
)
target_compile_options(plasma-auto-tiler-active-border_config PRIVATE -Wall -Wextra -Werror)

include(CTest)

if(BUILD_TESTING)
    add_executable(plasma-auto-tiler-active-border-logic-test
        activeborderlogic_test.cpp
    )
    target_link_libraries(plasma-auto-tiler-active-border-logic-test PRIVATE Qt6::Core Qt6::Gui)
    target_compile_options(plasma-auto-tiler-active-border-logic-test PRIVATE -Wall -Wextra -Werror)

    add_test(NAME native-effect-logic
        COMMAND plasma-auto-tiler-active-border-logic-test)

    add_executable(plasma-auto-tiler-active-border-group-test
        activebordergroup_test.cpp
    )
    add_dependencies(plasma-auto-tiler-active-border-group-test plasma-auto-tiler-effect-ffi-rs)
    target_link_libraries(plasma-auto-tiler-active-border-group-test PRIVATE
        "${EFFECT_STATICLIB}"
        Threads::Threads
        ${CMAKE_DL_LIBS}
        Qt6::Core
        Qt6::Gui
    )
    target_compile_options(plasma-auto-tiler-active-border-group-test PRIVATE -Wall -Wextra -Werror)

    add_test(NAME native-effect-group-highlight
        COMMAND plasma-auto-tiler-active-border-group-test)

    set(kcm_config_test_SOURCES
        activeborderconfig_module_test.cpp
        activeborderconfig_module.cpp
        shortcutreconciler.cpp
        ${config_SOURCES}
    )
    ki18n_wrap_ui(kcm_config_test_SOURCES activeborderconfig.ui)
    add_executable(plasma-auto-tiler-active-border-kcm-config-test
        ${kcm_config_test_SOURCES}
    )
    target_link_libraries(plasma-auto-tiler-active-border-kcm-config-test PRIVATE
        KF6::CoreAddons
        KF6::ConfigCore
        KF6::ConfigGui
        KF6::I18n
        KF6::KCMUtils
        KF6::WidgetsAddons
        Qt6::Core
        Qt6::DBus
        Qt6::Widgets
    )
    target_compile_definitions(plasma-auto-tiler-active-border-kcm-config-test PRIVATE
        -DTRANSLATION_DOMAIN="kwin"
        -DKPLUGINFACTORY_PLUGIN_CLASS_INTERNAL_NAME=ActiveBorderConfigModuleFactory
    )
    target_compile_options(plasma-auto-tiler-active-border-kcm-config-test PRIVATE -Wall -Wextra -Werror)

    add_test(NAME native-effect-kcm-dbus
        COMMAND plasma-auto-tiler-active-border-kcm-config-test dbus)
    add_test(NAME native-effect-kcm-hotapply
        COMMAND plasma-auto-tiler-active-border-kcm-config-test hotapply)
    add_test(NAME native-effect-kcm-border
        COMMAND plasma-auto-tiler-active-border-kcm-config-test border)
    add_test(NAME native-effect-kcm-config-reload
        COMMAND plasma-auto-tiler-active-border-kcm-config-test config)
    add_test(NAME native-effect-kcm-config-gaps
        COMMAND plasma-auto-tiler-active-border-kcm-config-test gaps)
    add_test(NAME native-effect-kcm-tiler-reload
        COMMAND plasma-auto-tiler-active-border-kcm-config-test reload)
    set_tests_properties(
        native-effect-kcm-dbus
        native-effect-kcm-hotapply
        native-effect-kcm-border
        native-effect-kcm-config-reload
        native-effect-kcm-tiler-reload
        native-effect-kcm-config-gaps
        PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen"
    )

    set(kcm_shortcut_test_SOURCES
        activeborderconfig_shortcut_test.cpp
        activeborderconfig_module.cpp
        shortcutreconciler.cpp
        ${config_SOURCES}
    )
    ki18n_wrap_ui(kcm_shortcut_test_SOURCES activeborderconfig.ui)
    add_executable(plasma-auto-tiler-active-border-kcm-shortcut-test
        ${kcm_shortcut_test_SOURCES}
    )
    target_link_libraries(plasma-auto-tiler-active-border-kcm-shortcut-test PRIVATE
        KF6::CoreAddons
        KF6::ConfigCore
        KF6::ConfigGui
        KF6::I18n
        KF6::KCMUtils
        KF6::WidgetsAddons
        Qt6::Core
        Qt6::DBus
        Qt6::Widgets
    )
    target_compile_definitions(plasma-auto-tiler-active-border-kcm-shortcut-test PRIVATE
        -DTRANSLATION_DOMAIN="kwin"
        -DKPLUGINFACTORY_PLUGIN_CLASS_INTERNAL_NAME=ActiveBorderConfigModuleFactory
    )
    target_compile_options(plasma-auto-tiler-active-border-kcm-shortcut-test PRIVATE -Wall -Wextra -Werror)

    add_test(NAME native-effect-kcm-shortcut-ordinary
        COMMAND plasma-auto-tiler-active-border-kcm-shortcut-test ordinary)
    add_test(NAME native-effect-kcm-shortcut-recovery
        COMMAND plasma-auto-tiler-active-border-kcm-shortcut-test recovery)
    add_test(NAME native-effect-kcm-shortcut-confirm
        COMMAND plasma-auto-tiler-active-border-kcm-shortcut-test confirm)
    add_test(NAME native-effect-kcm-shortcut-state
        COMMAND plasma-auto-tiler-active-border-kcm-shortcut-test state)
    add_test(NAME native-effect-kcm-shortcut-force
        COMMAND plasma-auto-tiler-active-border-kcm-shortcut-test force)
    add_test(NAME native-effect-kcm-shortcut-migration
        COMMAND plasma-auto-tiler-active-border-kcm-shortcut-test migration)
    set_tests_properties(
        native-effect-kcm-shortcut-ordinary
        native-effect-kcm-shortcut-recovery
        native-effect-kcm-shortcut-confirm
        native-effect-kcm-shortcut-state
        native-effect-kcm-shortcut-force
        native-effect-kcm-shortcut-migration
        PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen"
    )

    add_executable(plasma-auto-tiler-shortcut-reconciler-test
        shortcutreconciler_test.cpp
        shortcutreconciler.cpp
    )
    target_link_libraries(plasma-auto-tiler-shortcut-reconciler-test PRIVATE
        KF6::ConfigCore
        Qt6::Core
        Qt6::DBus
        Qt6::Gui
    )
    target_compile_options(plasma-auto-tiler-shortcut-reconciler-test PRIVATE -Wall -Wextra -Werror)

    add_test(NAME native-effect-shortcut-success
        COMMAND plasma-auto-tiler-shortcut-reconciler-test success)
    add_test(NAME native-effect-shortcut-conflict
        COMMAND plasma-auto-tiler-shortcut-reconciler-test conflict)
    add_test(NAME native-effect-shortcut-malformed
        COMMAND plasma-auto-tiler-shortcut-reconciler-test malformed)
    add_test(NAME native-effect-shortcut-owner
        COMMAND plasma-auto-tiler-shortcut-reconciler-test owner)
    add_test(NAME native-effect-shortcut-recovery
        COMMAND plasma-auto-tiler-shortcut-reconciler-test recovery)
    add_test(NAME native-effect-shortcut-external
        COMMAND plasma-auto-tiler-shortcut-reconciler-test external)
    add_test(NAME native-effect-shortcut-journal
        COMMAND plasma-auto-tiler-shortcut-reconciler-test journal)
    add_test(NAME native-effect-shortcut-force
        COMMAND plasma-auto-tiler-shortcut-reconciler-test force)
    add_test(NAME native-effect-shortcut-diag
        COMMAND plasma-auto-tiler-shortcut-reconciler-test diag)
    set_tests_properties(
        native-effect-shortcut-success
        native-effect-shortcut-conflict
        native-effect-shortcut-malformed
        native-effect-shortcut-owner
        native-effect-shortcut-recovery
        native-effect-shortcut-external
        native-effect-shortcut-journal
        native-effect-shortcut-force
        native-effect-shortcut-diag
        PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen"
    )

    add_test(NAME native-effect-metadata-factory-validation
        COMMAND ${CMAKE_COMMAND}
            -DMETADATA_FILE=${CMAKE_CURRENT_SOURCE_DIR}/metadata.json
            -DSOURCE_FILE=${CMAKE_CURRENT_SOURCE_DIR}/activewindowborder.cpp
            -DKCM_METADATA_FILE=${CMAKE_CURRENT_SOURCE_DIR}/activeborderconfig_module.json
            -DKCM_SOURCE_FILE=${CMAKE_CURRENT_SOURCE_DIR}/activeborderconfig_module.cpp
            -DGROUP_HEADER=${CMAKE_CURRENT_SOURCE_DIR}/activewindowborder.h
            -DGROUP_IMPL=${CMAKE_CURRENT_SOURCE_DIR}/activewindowborder.cpp
            -DGROUP_LOGIC=${CMAKE_CURRENT_SOURCE_DIR}/activeborderlogic.h
            -DGROUP_TEST=${CMAKE_CURRENT_SOURCE_DIR}/activebordergroup_test.cpp
            -DGROUP_FFI=${CMAKE_CURRENT_SOURCE_DIR}/group_highlight_ffi.h
            -DGROUP_RUST=${EFFECT_FFI_CRATE_DIR}/src/group_highlight.rs
            -DDRAG_HEADER=${CMAKE_CURRENT_SOURCE_DIR}/activewindowborder.h
            -DDRAG_IMPL=${CMAKE_CURRENT_SOURCE_DIR}/activewindowborder.cpp
            -DDRAG_FFI=${CMAKE_CURRENT_SOURCE_DIR}/drag_oracle_ffi.h
            -DDRAG_RUST=${EFFECT_FFI_CRATE_DIR}/src/drag_oracle.rs
            -DEXPECTED_PLUGIN_ID=plasma-auto-tiler-active-border
            -P ${CMAKE_CURRENT_SOURCE_DIR}/validate-metadata.cmake)

    add_test(NAME native-effect-unified-lifecycle
        COMMAND ${CMAKE_COMMAND}
            -DSOURCE_FILE=${CMAKE_CURRENT_SOURCE_DIR}/activewindowborder.cpp
            -DHEADER_FILE=${CMAKE_CURRENT_SOURCE_DIR}/activewindowborder.h
            -DCMAKE_FILE=${CMAKE_CURRENT_SOURCE_DIR}/CMakeLists.txt
            -P ${CMAKE_CURRENT_SOURCE_DIR}/validate-unified-lifecycle.cmake)

    # Effect Rust unit tests run through Cargo against the same workspace
    # staticlib sources, filtered per policy so each CTest keeps its focused
    # scope (replaces the retired rustc --test binaries).
    add_test(NAME native-effect-drag-oracle-rs
        COMMAND "${CARGO_PROGRAM}" test --release --locked
            ${EFFECT_CARGO_OFFLINE_ARG}
            --manifest-path "${EFFECT_FFI_CRATE_DIR}/Cargo.toml"
            -p tiler-kwin-effect-ffi --lib drag_oracle::
            --target-dir "${EFFECT_CARGO_TARGET_DIR}")

    add_test(NAME native-effect-group-highlight-rs
        COMMAND "${CARGO_PROGRAM}" test --release --locked
            ${EFFECT_CARGO_OFFLINE_ARG}
            --manifest-path "${EFFECT_FFI_CRATE_DIR}/Cargo.toml"
            -p tiler-kwin-effect-ffi --lib group_highlight::
            --target-dir "${EFFECT_CARGO_TARGET_DIR}")
endif()

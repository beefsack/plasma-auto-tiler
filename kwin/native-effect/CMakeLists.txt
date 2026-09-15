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

# Bare-rustc std-only staticlibs (group highlight policy plus the slice 1
# drag oracle): no Cargo, no crates, no network. find_program/find_package
# stay before both consumers so linkage never relies on transitive libs.
find_program(RUSTC_PROGRAM rustc REQUIRED)
# The Rust staticlibs reference pthread/dl (std thread internals, backtrace
# symbolization). Link them explicitly and portably so the shared plugins
# do not rely on transitive linkage.
find_package(Threads REQUIRED)

# Temporary active-group highlight policy: std-only Rust source compiled
# hermetically by rustc invoked from CMake, reusing the drag-oracle
# bare-rustc staticlib pattern.
set(GROUP_HIGHLIGHT_STATICLIB "${CMAKE_CURRENT_BINARY_DIR}/libgroup_highlight.a")
add_custom_command(
    OUTPUT "${GROUP_HIGHLIGHT_STATICLIB}"
    COMMAND "${RUSTC_PROGRAM}"
        --crate-type=staticlib
        -O
        --crate-name=group_highlight
        "${CMAKE_CURRENT_SOURCE_DIR}/group_highlight.rs"
        -o "${GROUP_HIGHLIGHT_STATICLIB}"
    DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/group_highlight.rs"
    COMMENT "Compiling std-only group_highlight.rs with rustc"
    VERBATIM
)
add_custom_target(plasma-auto-tiler-group-highlight-rs DEPENDS "${GROUP_HIGHLIGHT_STATICLIB}")

kcoreaddons_add_plugin(plasma-auto-tiler-active-border
    INSTALL_NAMESPACE "kwin/effects/plugins"
    SOURCES
        activewindowborder.h
        activewindowborder.cpp
        group_highlight_ffi.h
        ${config_SOURCES}
)
add_dependencies(plasma-auto-tiler-active-border plasma-auto-tiler-group-highlight-rs)
target_link_libraries(plasma-auto-tiler-active-border PRIVATE
    "${GROUP_HIGHLIGHT_STATICLIB}"
    Threads::Threads
    ${CMAKE_DL_LIBS}
    KWin::kwin
    KF6::ConfigCore
    KF6::ConfigGui
    KF6::ColorScheme
    Qt6::Core
    Qt6::Gui
)
target_compile_options(plasma-auto-tiler-active-border PRIVATE -Wall -Wextra -Werror)

# Slice 1 drag/final-geometry oracle: std-only Rust source compiled hermetically
# by rustc invoked from CMake. No Cargo, no crates, no network.
set(DRAG_ORACLE_STATICLIB "${CMAKE_CURRENT_BINARY_DIR}/libdrag_oracle.a")
add_custom_command(
    OUTPUT "${DRAG_ORACLE_STATICLIB}"
    COMMAND "${RUSTC_PROGRAM}"
        --crate-type=staticlib
        -O
        --crate-name=drag_oracle
        "${CMAKE_CURRENT_SOURCE_DIR}/drag_oracle.rs"
        -o "${DRAG_ORACLE_STATICLIB}"
    DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/drag_oracle.rs"
    COMMENT "Compiling std-only drag_oracle.rs with rustc"
    VERBATIM
)
add_custom_target(plasma-auto-tiler-drag-oracle-rs DEPENDS "${DRAG_ORACLE_STATICLIB}")

kcoreaddons_add_plugin(plasma-auto-tiler-drag-oracle
    INSTALL_NAMESPACE "kwin/effects/plugins"
    SOURCES
        dragoracle.h
        dragoracle.cpp
)
add_dependencies(plasma-auto-tiler-drag-oracle plasma-auto-tiler-drag-oracle-rs)
target_link_libraries(plasma-auto-tiler-drag-oracle PRIVATE
    "${DRAG_ORACLE_STATICLIB}"
    Threads::Threads
    ${CMAKE_DL_LIBS}
    KWin::kwin
    Qt6::Core
    Qt6::Gui
    Qt6::DBus
)
target_compile_options(plasma-auto-tiler-drag-oracle PRIVATE -Wall -Wextra -Werror)

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
    add_dependencies(plasma-auto-tiler-active-border-group-test plasma-auto-tiler-group-highlight-rs)
    target_link_libraries(plasma-auto-tiler-active-border-group-test PRIVATE
        "${GROUP_HIGHLIGHT_STATICLIB}"
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

    add_test(NAME native-effect-kcm-config-malformed
        COMMAND plasma-auto-tiler-active-border-kcm-config-test malformed)
    add_test(NAME native-effect-kcm-config-valid
        COMMAND plasma-auto-tiler-active-border-kcm-config-test valid)
    add_test(NAME native-effect-kcm-config-missing
        COMMAND plasma-auto-tiler-active-border-kcm-config-test missing)
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
    set_tests_properties(
        native-effect-kcm-config-malformed
        native-effect-kcm-config-valid
        native-effect-kcm-config-missing
        native-effect-kcm-dbus
        native-effect-kcm-hotapply
        native-effect-kcm-border
        native-effect-kcm-config-reload
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
    set_tests_properties(
        native-effect-kcm-shortcut-ordinary
        native-effect-kcm-shortcut-recovery
        native-effect-kcm-shortcut-confirm
        native-effect-kcm-shortcut-state
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
    set_tests_properties(
        native-effect-shortcut-success
        native-effect-shortcut-conflict
        native-effect-shortcut-malformed
        native-effect-shortcut-owner
        native-effect-shortcut-recovery
        native-effect-shortcut-external
        native-effect-shortcut-journal
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
            -DGROUP_RUST=${CMAKE_CURRENT_SOURCE_DIR}/group_highlight.rs
            -DEXPECTED_PLUGIN_ID=plasma-auto-tiler-active-border
            -P ${CMAKE_CURRENT_SOURCE_DIR}/validate-metadata.cmake)

    add_test(NAME native-effect-drag-oracle-validation
        COMMAND ${CMAKE_COMMAND}
            -DDRAG_METADATA_FILE=${CMAKE_CURRENT_SOURCE_DIR}/dragoracle-metadata.json
            -DDRAG_SOURCE_FILE=${CMAKE_CURRENT_SOURCE_DIR}/dragoracle.h
            -DDRAG_IMPL_FILE=${CMAKE_CURRENT_SOURCE_DIR}/dragoracle.cpp
            -DDRAG_FFI_FILE=${CMAKE_CURRENT_SOURCE_DIR}/drag_oracle_ffi.h
            -DDRAG_RUST_FILE=${CMAKE_CURRENT_SOURCE_DIR}/drag_oracle.rs
            -DEXPECTED_PLUGIN_ID=plasma-auto-tiler-drag-oracle
            -P ${CMAKE_CURRENT_SOURCE_DIR}/validate-dragoracle.cmake)

    # Targeted Rust oracle unit tests: rustc --test on the std-only source.
    add_custom_command(
        OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/drag_oracle_test"
        COMMAND "${RUSTC_PROGRAM}"
            --test
            "${CMAKE_CURRENT_SOURCE_DIR}/drag_oracle.rs"
            -o "${CMAKE_CURRENT_BINARY_DIR}/drag_oracle_test"
        DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/drag_oracle.rs"
        COMMENT "Building drag oracle unit tests with rustc --test"
        VERBATIM
    )
    add_custom_target(plasma-auto-tiler-drag-oracle-test-bin ALL DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/drag_oracle_test")
    add_test(NAME native-effect-drag-oracle-rs
        COMMAND "${CMAKE_CURRENT_BINARY_DIR}/drag_oracle_test")

    # Targeted Rust group-highlight policy unit tests: rustc --test on the
    # std-only source, mirroring the drag-oracle pattern.
    add_custom_command(
        OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/group_highlight_test"
        COMMAND "${RUSTC_PROGRAM}"
            --test
            "${CMAKE_CURRENT_SOURCE_DIR}/group_highlight.rs"
            -o "${CMAKE_CURRENT_BINARY_DIR}/group_highlight_test"
        DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/group_highlight.rs"
        COMMENT "Building group highlight unit tests with rustc --test"
        VERBATIM
    )
    add_custom_target(plasma-auto-tiler-group-highlight-test-bin ALL DEPENDS "${CMAKE_CURRENT_BINARY_DIR}/group_highlight_test")
    add_test(NAME native-effect-group-highlight-rs
        COMMAND "${CMAKE_CURRENT_BINARY_DIR}/group_highlight_test")
endif()

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

kcoreaddons_add_plugin(plasma-auto-tiler-active-border
    INSTALL_NAMESPACE "kwin/effects/plugins"
    SOURCES
        activewindowborder.h
        activewindowborder.cpp
        ${config_SOURCES}
)
target_link_libraries(plasma-auto-tiler-active-border PRIVATE
    KWin::kwin
    KF6::ConfigCore
    KF6::ConfigGui
    KF6::ColorScheme
    Qt6::Core
    Qt6::Gui
)
target_compile_options(plasma-auto-tiler-active-border PRIVATE -Wall -Wextra -Werror)

set(kcm_SOURCES
    activeborderconfig_module.cpp
    activeborderconfig_module.h
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

    set(kcm_config_test_SOURCES
        activeborderconfig_module_test.cpp
        activeborderconfig_module.cpp
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
    set_tests_properties(
        native-effect-kcm-config-malformed
        native-effect-kcm-config-valid
        native-effect-kcm-config-missing
        native-effect-kcm-dbus
        native-effect-kcm-hotapply
        native-effect-kcm-border
        native-effect-kcm-config-reload
        PROPERTIES ENVIRONMENT "QT_QPA_PLATFORM=offscreen"
    )

    add_test(NAME native-effect-metadata-factory-validation
        COMMAND ${CMAKE_COMMAND}
            -DMETADATA_FILE=${CMAKE_CURRENT_SOURCE_DIR}/metadata.json
            -DSOURCE_FILE=${CMAKE_CURRENT_SOURCE_DIR}/activewindowborder.cpp
            -DKCM_METADATA_FILE=${CMAKE_CURRENT_SOURCE_DIR}/activeborderconfig_module.json
            -DKCM_SOURCE_FILE=${CMAKE_CURRENT_SOURCE_DIR}/activeborderconfig_module.cpp
            -DEXPECTED_PLUGIN_ID=plasma-auto-tiler-active-border
            -P ${CMAKE_CURRENT_SOURCE_DIR}/validate-metadata.cmake)
endif()

cmake_minimum_required(VERSION 3.19)

project(plasma-auto-tiler-native-effect LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

find_package(ECM 6.26.0 REQUIRED NO_MODULE)
set(CMAKE_MODULE_PATH ${ECM_MODULE_PATH})

include(KDEInstallDirs)
include(KDECMakeSettings)
include(ECMSetupQtPluginMacroNames)

find_package(Qt6 REQUIRED COMPONENTS Core Widgets)

find_package(KWin REQUIRED)

ecm_setup_qtplugin_macro_names(
    MACRO_NAMES
        KWIN_EFFECT_FACTORY
        KWIN_EFFECT_FACTORY_ENABLED
        KWIN_EFFECT_FACTORY_SUPPORTED
        KWIN_EFFECT_FACTORY_SUPPORTED_ENABLED
)

kcoreaddons_add_plugin(plasma-auto-tiler-active-border
    INSTALL_NAMESPACE "kwin/effects/plugins"
    SOURCES
        activewindowborder.h
        activewindowborder.cpp
)
target_link_libraries(plasma-auto-tiler-active-border PRIVATE KWin::kwin)
target_compile_options(plasma-auto-tiler-active-border PRIVATE -Wall -Wextra -Werror)

include(CTest)

if(BUILD_TESTING)
    add_executable(plasma-auto-tiler-active-border-logic-test
        activeborderlogic_test.cpp
    )
    target_link_libraries(plasma-auto-tiler-active-border-logic-test PRIVATE Qt6::Core)
    target_compile_options(plasma-auto-tiler-active-border-logic-test PRIVATE -Wall -Wextra -Werror)

    add_test(NAME native-effect-logic
        COMMAND plasma-auto-tiler-active-border-logic-test)

    add_test(NAME native-effect-metadata-factory-validation
        COMMAND ${CMAKE_COMMAND}
            -DMETADATA_FILE=${CMAKE_CURRENT_SOURCE_DIR}/metadata.json
            -DSOURCE_FILE=${CMAKE_CURRENT_SOURCE_DIR}/activewindowborder.cpp
            -DEXPECTED_PLUGIN_ID=plasma-auto-tiler-active-border
            -P ${CMAKE_CURRENT_SOURCE_DIR}/validate-metadata.cmake)
endif()

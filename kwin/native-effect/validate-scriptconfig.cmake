# AR15 script settings discovery validation: the KWin script package
# metadata must route X-KDE-ConfigModule to the project-provided native
# script KCM through the qualified kwin/scripts/configs namespace, and the
# native plugin must exist in that install namespace with a matching id and
# QWidget KCModule factory. The generic scripted KCM
# (kcm_kwin4_genericscripted) must not be referenced: its ScriptingConfig
# save calls the empty ScriptingConfig::reload hook.
if(NOT DEFINED SCRIPT_METADATA_FILE OR NOT DEFINED SCRIPT_KCM_METADATA_FILE OR NOT DEFINED SCRIPT_KCM_SOURCE_FILE OR NOT DEFINED SCRIPT_CMAKE_FILE OR NOT DEFINED EXPECTED_SCRIPT_CONFIG_REFERENCE OR NOT DEFINED EXPECTED_SCRIPT_KCM_ID)
    message(FATAL_ERROR "usage: cmake -DSCRIPT_METADATA_FILE=<file> -DSCRIPT_KCM_METADATA_FILE=<file> -DSCRIPT_KCM_SOURCE_FILE=<file> -DSCRIPT_CMAKE_FILE=<file> -DEXPECTED_SCRIPT_CONFIG_REFERENCE=<namespace/id> -DEXPECTED_SCRIPT_KCM_ID=<id> -P validate-scriptconfig.cmake")
endif()

file(READ "${SCRIPT_METADATA_FILE}" SCRIPT_METADATA)
file(READ "${SCRIPT_KCM_METADATA_FILE}" SCRIPT_KCM_METADATA)
file(READ "${SCRIPT_KCM_SOURCE_FILE}" SCRIPT_KCM_SOURCE)
file(READ "${SCRIPT_CMAKE_FILE}" SCRIPT_CMAKE)

string(JSON SCRIPT_CONFIG_MODULE ERROR_VARIABLE ERROR GET "${SCRIPT_METADATA}" "X-KDE-ConfigModule")
if(ERROR OR NOT SCRIPT_CONFIG_MODULE STREQUAL EXPECTED_SCRIPT_CONFIG_REFERENCE)
    message(FATAL_ERROR "script discovery validation failed: X-KDE-ConfigModule '${SCRIPT_CONFIG_MODULE}' must be '${EXPECTED_SCRIPT_CONFIG_REFERENCE}'")
endif()

string(JSON SCRIPT_KCM_ID ERROR_VARIABLE ERROR GET "${SCRIPT_KCM_METADATA}" "KPlugin" "Id")
if(ERROR OR NOT SCRIPT_KCM_ID STREQUAL EXPECTED_SCRIPT_KCM_ID)
    message(FATAL_ERROR "script discovery validation failed: script KCM KPlugin/Id '${SCRIPT_KCM_ID}' must match '${EXPECTED_SCRIPT_KCM_ID}'")
endif()

string(FIND "${SCRIPT_CONFIG_MODULE}" "kcm_kwin4_genericscripted" GENERIC_POS)
if(NOT GENERIC_POS EQUAL -1)
    message(FATAL_ERROR "script discovery validation failed: X-KDE-ConfigModule must not route to the generic scripted KCM")
endif()

string(FIND "${SCRIPT_CONFIG_MODULE}" "kwin/scripts/configs/${EXPECTED_SCRIPT_KCM_ID}" NAMESPACE_POS)
if(NOT NAMESPACE_POS EQUAL -1)
    # Qualified namespace/id reference: nothing further to check on the form.
else()
    message(FATAL_ERROR "script discovery validation failed: X-KDE-ConfigModule '${SCRIPT_CONFIG_MODULE}' must be the qualified kwin/scripts/configs reference")
endif()

string(FIND "${SCRIPT_CMAKE}" "INSTALL_NAMESPACE \"kwin/scripts/configs\"" NAMESPACE_CMAKE_POS)
if(NAMESPACE_CMAKE_POS EQUAL -1)
    message(FATAL_ERROR "script discovery validation failed: INSTALL_NAMESPACE \"kwin/scripts/configs\" not found in ${SCRIPT_CMAKE_FILE}")
endif()

string(FIND "${SCRIPT_KCM_SOURCE}" "K_PLUGIN_CLASS_WITH_JSON" KCM_FACTORY_POS)
if(KCM_FACTORY_POS EQUAL -1)
    message(FATAL_ERROR "script discovery validation failed: K_PLUGIN_CLASS_WITH_JSON macro not found in ${SCRIPT_KCM_SOURCE_FILE}")
endif()

message(STATUS "script KCM discovery validation passed for ${SCRIPT_METADATA_FILE}")

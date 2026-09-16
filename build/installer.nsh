; SA Premier — Windows interactive installer (Setup Wizard stijl)
; - Eén kleine Lite-installer (~150 MB) die ALTIJD werkt.
; - Deze pagina vraagt: Lite / Full / Aangepast → schrijft keuze weg
; - De app leest die keuze bij eerste start (installer-choice.txt → ai-setup.json).
;   Zo werkt dezelfde flow op Windows (.exe) en macOS/Linux (in-app wizard).
;
; macOS/Linux: DMG/AppImage hebben geen NSIS-pagina — daar verschijnt
; dezelfde wizard in de app zelf (Home → 🤖 AI-setup).

!include "nsDialogs.nsh"
!include "LogicLib.nsh"

Var Dialog
Var LiteRadio
Var FullRadio
Var CustomRadio
Var ComfyCheck
Var MusicCheck
Var OllamaCheck
Var LiteState
Var FullState
Var CustomState
Var AiSetupChoice

!macro customHeader
  ; Wizard-pagina met keuzes — komt als eerste pagina (voor Welkom)
  ; (ligt technisch voor Welkom, maar nog steeds vóór de installatie — werkt prima.)
  Page custom AiChoiceCreate AiChoiceLeave
!macroend

Function AiChoiceCreate
  nsDialogs::Create 1018
  Pop $Dialog
  ${If} $Dialog == error
    Abort
  ${EndIf}

  !insertmacro MUI_HEADER_TEXT "AI-setup — jouw keuze" "Kies meteen of AI-modellen mee moeten of later gedownload worden. Je kunt dit later altijd wijzigen in de app (🤖 AI-setup)."

  ${NSD_CreateLabel} 0 0 100% 10u "De app werkt ALTIJD — ook zonder AI (Lite). Dit kiest alleen hoe je AI krijgt:"
  Pop $0

  ${NSD_CreateRadioButton} 0 16u 100% 10u "☁️  Licht — download bij gebruik (aanbevolen, ~150 MB installer). Modellen komen pas bij eerste gebruik."
  Pop $LiteRadio
  ${NSD_CreateRadioButton} 0 30u 100% 10u "📦  Volledig — alles meteen (~8–15 GB). Alleen als je al modellen in resources/models hebt gebundeld."
  Pop $FullRadio
  ${NSD_CreateRadioButton} 0 44u 100% 10u "🛠️  Aangepast — zelf kiezen welke engines aan staan."
  Pop $CustomRadio

  ; Defaults: Lite aangevinkt, Custom-details uit
  SendMessage $LiteRadio ${BM_SETCHECK} ${BST_CHECKED} 0
  StrCpy $LiteState ${BST_CHECKED}
  StrCpy $FullState ${BST_UNCHECKED}
  StrCpy $CustomState ${BST_UNCHECKED}

  ${NSD_CreateLabel} 8u 62u 100% 8u "Bij Aangepast:"
  Pop $0
  ${NSD_CreateCheckbox} 12u 72u 90% 9u "🎨 ComfyUI — foto-modellen (SD1.5/Realistic)"
  Pop $ComfyCheck
  ${NSD_CreateCheckbox} 12u 82u 90% 9u "🎵 MusicGen — muziek-modellen"
  Pop $MusicCheck
  ${NSD_CreateCheckbox} 12u 92u 90% 9u "💬 Ollama — tekst-AI"
  Pop $OllamaCheck

  ; Custom-checks default aan, maar disabled tot "Aangepast" gekozen wordt
  SendMessage $ComfyCheck ${BM_SETCHECK} ${BST_CHECKED} 0
  SendMessage $MusicCheck ${BM_SETCHECK} ${BST_CHECKED} 0
  SendMessage $OllamaCheck ${BM_SETCHECK} ${BST_CHECKED} 0
  EnableWindow $ComfyCheck 0
  EnableWindow $MusicCheck 0
  EnableWindow $OllamaCheck 0

  ; Toggling
  ${NSD_OnClick} $LiteRadio AiChoiceOnChange
  ${NSD_OnClick} $FullRadio AiChoiceOnChange
  ${NSD_OnClick} $CustomRadio AiChoiceOnChange

  nsDialogs::Show
FunctionEnd

Function AiChoiceOnChange
  ${NSD_GetState} $LiteRadio $LiteState
  ${NSD_GetState} $FullRadio $FullState
  ${NSD_GetState} $CustomRadio $CustomState
  ${If} $CustomState == ${BST_CHECKED}
    EnableWindow $ComfyCheck 1
    EnableWindow $MusicCheck 1
    EnableWindow $OllamaCheck 1
  ${Else}
    EnableWindow $ComfyCheck 0
    EnableWindow $MusicCheck 0
    EnableWindow $OllamaCheck 0
  ${EndIf}
FunctionEnd

Function AiChoiceLeave
  ${NSD_GetState} $LiteRadio $LiteState
  ${NSD_GetState} $FullRadio $FullState
  ${NSD_GetState} $CustomRadio $CustomState
  ${If} $LiteState == ${BST_CHECKED}
    StrCpy $AiSetupChoice "ondemand"
  ${ElseIf} $FullState == ${BST_CHECKED}
    StrCpy $AiSetupChoice "full"
  ${Else}
    ; custom — bouw string comfy=X,music=X,ollama=X
    ${NSD_GetState} $ComfyCheck $0
    ${NSD_GetState} $MusicCheck $1
    ${NSD_GetState} $OllamaCheck $2
    StrCpy $AiSetupChoice "custom:"
    ${If} $0 == ${BST_CHECKED}
      StrCpy $AiSetupChoice "$AiSetupChoice comfy=1,"
    ${Else}
      StrCpy $AiSetupChoice "$AiSetupChoice comfy=0,"
    ${EndIf}
    ${If} $1 == ${BST_CHECKED}
      StrCpy $AiSetupChoice "$AiSetupChoice music=1,"
    ${Else}
      StrCpy $AiSetupChoice "$AiSetupChoice music=0,"
    ${EndIf}
    ${If} $2 == ${BST_CHECKED}
      StrCpy $AiSetupChoice "$AiSetupChoice ollama=1"
    ${Else}
      StrCpy $AiSetupChoice "$AiSetupChoice ollama=0"
    ${EndIf}
  ${EndIf}
FunctionEnd

; ---- Na het kopiëren: keuze wegschrijven ----
!macro customInstall
  ; Schrijf naar install-map (gelezen door ai-setup.ts via bundledBase/installer-choice.txt)
  FileOpen $0 "$INSTDIR\resources\installer-choice.txt" w
  FileWrite $0 "$AiSetupChoice"
  FileClose $0

  ; Best-effort: schrijf ook meteen naar %APPDATA%\SA Premier\installer-choice.txt (userData)
  ; zodat de app bij eerste start niet nog een wizard hoeft te tonen.
  SetShellVarContext current
  CreateDirectory "$APPDATA\SA Premier"
  FileOpen $0 "$APPDATA\SA Premier\installer-choice.txt" w
  FileWrite $0 "$AiSetupChoice"
  FileClose $0

  ; De app zelf leest installer-choice.txt bij eerste start en zet die om naar
  ; ai-setup.json (zie src/main/ai-setup.ts). Installer hoeft dus niet te parsen —
  ; alleen de keuze-file neerzetten volstaat.
!macroend

!macro customUnInstall
  ; Laat ai-setup.json staan bij deïnstallatie (user data behouden)
!macroend

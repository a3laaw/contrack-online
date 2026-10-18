from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def test_run_bat_quotes_python_paths_with_spaces():
    s = (ROOT / "RUN.bat").read_text(encoding="utf-8", errors="ignore")
    assert '"%PYW_CMD%"' in s
    assert 'start "ConTrack" /D "%~dp0" "%PYW_CMD%"' in s
    assert '%~dp0.venv\\Scripts\\pythonw.exe' not in s
    assert 'set "PYW_CMD=%CD%\\.venv\\Scripts\\pythonw.exe"' in s


def test_run_debug_bat_quotes_python_paths_with_spaces():
    s = (ROOT / "RUN_DEBUG.bat").read_text(encoding="utf-8", errors="ignore")
    assert '"%PY_CMD%"' in s
    assert '"%~dp0main.py"' in s
    assert 'set "PY_CMD=%CD%\\.venv\\Scripts\\python.exe"' in s


def test_install_bat_checks_libreoffice_for_pdf_export():
    s = (ROOT / "INSTALL.bat").read_text(encoding="utf-8", errors="ignore")
    assert "Checking LibreOffice" in s
    assert "TheDocumentFoundation.LibreOffice" in s
    assert "winget install" in s


if __name__ == "__main__":
    test_run_bat_quotes_python_paths_with_spaces()
    test_run_debug_bat_quotes_python_paths_with_spaces()
    test_install_bat_checks_libreoffice_for_pdf_export()
    print("OK: Windows launcher paths are quoted and INSTALL checks LibreOffice")

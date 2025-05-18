import sys
import logging
from PyQt5.QtWidgets import QApplication
from controller import Controller
from gui import MainWindow

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

if __name__ == '__main__':
    logger.info('Starting SnapSort')
    app = QApplication(sys.argv)
    controller = Controller(num_workers=4)
    window = MainWindow(controller)
    window.show()
    exit_code = app.exec_()
    logger.info('Exiting with code %s', exit_code)
    sys.exit(exit_code)
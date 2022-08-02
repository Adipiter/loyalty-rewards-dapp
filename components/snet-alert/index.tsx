import Alert from '@mui/material/Alert';
import propTypes from 'prop-types';
import { useMemo } from 'react';
import styles from './styles';
import WarningIcon from '@mui/icons-material/Warning';
import { makeStyles } from '@mui/styles';
import InfoIcon from '@mui/icons-material/Info';

const useStyles = makeStyles(styles);

const SnetAlert = ({ error, type = 'error' }) => {
  const classes = useStyles();

  const className = useMemo(() => {
    switch (type) {
      case 'success':
        return classes.successMsg;
      case 'info':
        return classes.pendingMsg;
      default:
        return {};
    }
  }, [type]);

  const icon = useMemo(() => {
    if (type === 'error') {
      return <WarningIcon sx={{ color: 'alertMsg.main' }} />;
    } else if (type === 'info') {
      return <InfoIcon color="primary" />;
    }
    return false;
  }, [type]);

  return (
    <Alert icon={icon} severity={type} variant="outlined" className={`${classes.alertBox} ${className}`}>
      <p>{error}</p>
    </Alert>
  );
};

SnetAlert.propTypes = {
  error: propTypes.string.isRequired,
  type: propTypes.string,
};

export default SnetAlert;
